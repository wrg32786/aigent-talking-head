# Matte cleanup shared by kit/mask.py. Ported from the v3.1 hero-reel pass: island and hole
# fill, speck removal, RGB-guided edge refine, flow-guided temporal smoothing (BiRefNet has
# no temporal state, so per-frame flicker has to be taken out here), a light erode + feather,
# and edge decontamination of the person layer so a background rim does not ride over the type.
# Guided filter uses a float guide and nan_to_num (a uint8 guide can leak NaNs into the EMA).
import numpy as np, cv2

K3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
K9 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
K13 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
K17 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (17, 17))

def islands_and_holes(a):
    """a is float32 0..1. Drop small foreground specks, fill small enclosed holes."""
    H, W = a.shape
    b = (a > 0.5).astype(np.uint8)
    n, lab, st, _ = cv2.connectedComponentsWithStats(b, 8)
    if n <= 1:
        return a
    areas = st[1:, cv2.CC_STAT_AREA]
    big = areas.max()
    keep = np.zeros(n, np.uint8)
    keep[1:] = (areas >= max(0.03 * big, 2500))
    km = keep[lab]
    a = a * cv2.dilate(km, K17).astype(np.float32)
    inv = (1 - km).astype(np.uint8)
    n2, lab2, st2, _ = cv2.connectedComponentsWithStats(inv, 4)
    fill = np.zeros_like(km)
    for j in range(1, n2):
        x, y, w, h, ar = st2[j]
        if x > 0 and y > 0 and x + w < W and y + h < H and ar < W * H * 0.004:
            fill[lab2 == j] = 1
    if fill.any():
        a = np.maximum(a, cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 1.5))
    return a

def guided_edge(a, rgb):
    """Refine only the soft edge band against the RGB image."""
    band = cv2.dilate(((a > 0.03) & (a < 0.97)).astype(np.uint8), K13).astype(bool)
    if not band.any():
        return a
    guide = rgb.astype(np.float32) / 255
    try:
        gf = cv2.ximgproc.guidedFilter(guide, np.ascontiguousarray(a, np.float32), 3, 1e-3)
    except Exception:
        gf = cv2.GaussianBlur(a, (0, 0), 1.2)
    return np.where(band, np.clip(np.nan_to_num(gf), 0, 1), a)

def temporal_flow(a, rgb, state, cut_luma=18):
    """Warp the previous matte with Farneback flow and blend where it agrees. Hard cuts reset."""
    H, W = a.shape
    if state.get('grid') is None or state['grid'][0].shape != (H // 2, W // 2):
        gx, gy = np.meshgrid(np.arange(W // 2, dtype=np.float32), np.arange(H // 2, dtype=np.float32))
        state['grid'] = (gx, gy)
    g = cv2.resize(cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY), (W // 2, H // 2), interpolation=cv2.INTER_AREA)
    prev_a, prev_g = state.get('prev_a'), state.get('prev_g')
    cut = False
    if prev_a is not None:
        if np.abs(g.astype(np.int16) - prev_g).mean() > cut_luma:
            cut = True
        else:
            gx, gy = state['grid']
            fl = cv2.calcOpticalFlowFarneback(g, prev_g.astype(np.uint8), None, 0.5, 3, 21, 3, 5, 1.1, 0)
            mx = cv2.resize(gx + fl[..., 0], (W, H)) * 2
            my = cv2.resize(gy + fl[..., 1], (W, H)) * 2
            wp = cv2.remap(prev_a, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            w = 0.5 * np.exp(-np.abs(a - wp) * 7)
            a = w * wp + (1 - w) * a
    state['prev_a'] = a.copy()
    state['prev_g'] = g.astype(np.int16)
    return a, cut

def tighten(a, erode=True, sigma=0.6):
    """Kill a 1 px light fringe without leaving a dark line. Milder than the RVM-specific ramp squeeze."""
    x = cv2.erode(a, K3) if erode else a
    return np.clip(cv2.GaussianBlur(x, (0, 0), sigma), 0, 1)

def refine_frame(a, rgb, state, temporal=True):
    """Full cleanup on one float matte. Reset state['prev_a'] at the start of each title window."""
    a = islands_and_holes(np.clip(a.astype(np.float32), 0, 1))
    a = guided_edge(a, rgb)
    cut = False
    if temporal:
        a, cut = temporal_flow(a, rgb, state)
    a = tighten(a)
    return a, cut

def decontaminate(rgb, a):
    """Replace soft-edge colours with a spread from the solid interior. a is float 0..1; rgb is uint8 RGB.
    Returns (rgb_uint8, alpha_uint8) ready for a BGRA person layer. The output alpha is slightly tightened
    so a moving edge stays crisp over type."""
    au = np.clip(a * 255, 0, 255).astype(np.uint8)
    aout = np.clip((au.astype(np.float32) - 64) * 2 + 0.5, 0, 255).astype(np.uint8)
    img = rgb.astype(np.float32)
    af = au.astype(np.float32) / 255
    band = ((au > 2) & (au < 253))
    bandd = cv2.dilate(band.astype(np.uint8), K9).astype(bool)
    if bandd.any():
        core = cv2.erode((au > 250).astype(np.uint8), K9).astype(np.float32)
        num = cv2.GaussianBlur(img * core[..., None], (0, 0), 5)
        den = cv2.GaussianBlur(core, (0, 0), 5)[..., None]
        spread = num / np.maximum(den, 1e-4)
        wfg = np.clip((1 - af) * 1.6, 0, 1)[..., None] * (den > 0.02)
        sel = bandd[..., None] & (au < 250)[..., None]
        img = np.where(sel, img * (1 - wfg) + spread * wfg, img)
    return np.clip(img, 0, 255).astype(np.uint8), aout

# One place that names the matte models and opens them: kit/mask.py (titles behind the head) and
# effects/fx_runner.py (the effects pass) both use it, so the two masks cannot drift apart.
# birefnet-portrait gives the best edge on a person; birefnet-general-lite is about twice as fast.
MATTE_MODELS = {'birefnet': 'birefnet-general-lite', 'birefnet-general-lite': 'birefnet-general-lite', 'birefnet-portrait': 'birefnet-portrait'}

def matte_session(model='birefnet'):
    """rembg session for a matte model, on the GPU when ONNX Runtime has a provider for it, else the CPU.
    Measured on an Intel Arc B390 through DirectML at 1080x1920: birefnet-general-lite 0.98 s/frame and
    birefnet-portrait 1.94 s/frame, against 4.2 and 8.8 on the CPU, with the same mask."""
    import onnxruntime as ort
    from rembg import new_session
    have = ort.get_available_providers()
    prov = [p for p in ('DmlExecutionProvider', 'CUDAExecutionProvider', 'CoreMLExecutionProvider', 'CPUExecutionProvider') if p in have]
    return new_session(MATTE_MODELS[model], providers=prov)

def matte_raw(session, rgb):
    """Float 0..1 matte for one RGB frame, at the frame's size, before any cleanup."""
    from PIL import Image
    raw = np.array(session.predict(Image.fromarray(rgb))[0].convert('L'), dtype=np.float32) / 255
    if raw.shape != rgb.shape[:2]:
        raw = cv2.resize(raw, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    return raw
