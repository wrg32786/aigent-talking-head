# Matte cleanup shared by kit/mask.py. Ported from the v3.1 hero-reel pass: island and hole
# fill, speck removal, RGB-guided edge refine, flow-guided temporal smoothing (BiRefNet has
# no temporal state, so per-frame flicker has to be taken out here), a light erode + feather,
# and edge decontamination of the person layer so a background rim does not ride over the type.
# Guided filter uses a float guide and nan_to_num (a uint8 guide can leak NaNs into the EMA).
import sys
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

def tighten(a, rgb=None, erode=True, sigma=0.6):
    """Kill a 1 px light fringe without leaving a dark line. Hair-friendly: where the edge band is fine texture (strands,
    flyaways) the soft alpha is kept instead of eroded, so wisps stay instead of turning into a hard helmet edge."""
    if not erode:
        return np.clip(cv2.GaussianBlur(a, (0, 0), sigma), 0, 1)
    x = cv2.erode(a, K3)
    if rgb is not None:
        g = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY).astype(np.float32) / 255
        tex = cv2.GaussianBlur(np.abs(cv2.Laplacian(g, cv2.CV_32F, ksize=3)), (0, 0), 2.0)
        soft = ((a > 0.04) & (a < 0.96)).astype(np.float32)
        hair = np.clip((tex - 0.025) / 0.05, 0, 1) * cv2.GaussianBlur(soft, (0, 0), 2.0)
        x = hair * a + (1 - hair) * x
    return np.clip(cv2.GaussianBlur(x, (0, 0), sigma), 0, 1)

def ema_interior(a, state, keep=0.35):
    """Exponential moving average on the solid interior and background only (not the edge band, which the flow pass
    handles), so a frame-to-frame wobble in BiRefNet's confidence cannot breathe through the type."""
    prev = state.get('ema')
    if prev is None or prev.shape != a.shape:
        state['ema'] = a.copy(); return a
    solid = ((a < 0.03) | (a > 0.97)) & ((prev < 0.03) | (prev > 0.97))
    out = np.where(solid, keep * prev + (1 - keep) * a, a).astype(np.float32)
    state['ema'] = out
    return out

def refine_frame(a, rgb, state, temporal=True):
    """Full cleanup on one float matte. Reset state['prev_a'] at the start of each title window."""
    a = islands_and_holes(np.clip(a.astype(np.float32), 0, 1))
    a = guided_edge(a, rgb)
    cut = False
    if temporal:
        a, cut = temporal_flow(a, rgb, state)
        if cut:
            state['ema'] = None
        a = ema_interior(a, state)
    a = tighten(a, rgb)
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

# One place that names the matte models and opens them: kit/mask.py (titles behind the head), kit/anchors.py and
# effects/fx_runner.py (the effects pass) all use it, so the masks cannot drift apart.
#
# BiRefNet tiers (all MIT, ZhengPeng7/BiRefNet; ONNX exports hosted by rembg, MIT), slowest and best first:
#   1. BiRefNet_HR / HR-matting: 2048x2048 input, about 4x the compute of tier 2. Not used (too slow on a CPU).
#   2. birefnet-portrait, birefnet-general (and massive, dis, hrsod): Swin-L backbone at 1024x1024. birefnet-portrait is
#      the default for anything behind the head: trained on people, best edge on hair in a side-by-side on real footage.
#   3. birefnet-general-lite: Swin-T backbone at 1024x1024, about 2.5x faster, but it can keep a chair back or a
#      lamp as part of the person. Kept for the effects pass and as a faster option.
# "birefnet" means birefnet-general-lite here (the effects pass, which mattes every frame); kit/mask.py maps its own
# "birefnet" to birefnet-portrait.
MATTE_MODELS = {'birefnet': 'birefnet-general-lite', 'birefnet-lite': 'birefnet-general-lite', 'birefnet-general-lite': 'birefnet-general-lite',
                'birefnet-general': 'birefnet-general', 'birefnet-portrait': 'birefnet-portrait'}
MATTE_URLS = {
    'birefnet-general-lite': 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-bb_swin_v1_tiny-epoch_232.onnx',
    'birefnet-general': 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-general-epoch_244.onnx',
    'birefnet-portrait': 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/BiRefNet-portrait-epoch_150.onnx',
}
MATTE_MB = {'birefnet-general-lite': 214, 'birefnet-general': 928, 'birefnet-portrait': 928}
# Peak memory of one BiRefNet frame at 1024x1024 on ONNX Runtime's CPU provider with the settings in Matter (arena off,
# prepacking off), measured as peak RSS on Linux: lite 6.6 GB, portrait and general 7.5 GB. Almost all of it is the
# Swin attention activations, so the lighter model saves little memory; the MediaPipe preview needs about 0.3 GB.
# With ONNX Runtime's defaults (arena on, what rembg's new_session uses) the same frame grew past 15 GB and was killed on
# a 16 GB machine. Need = peak + 0.8 GB for the decoder, encoder and cleanup.
# the whole mask.py run (session + flow + cleanup + ffmpeg pipes) peaked at 8.0 GB with portrait on real footage, about
# 0.5 GB above the one-frame number, so the table is the full run (lite by the same margin)
MATTE_PEAK_GB = {
    'cpu': {'birefnet-general-lite': 7.1, 'birefnet-general': 8.0, 'birefnet-portrait': 8.0},
    # shortcut: only birefnet-portrait was measured on DirectML (21.3 GB and about 25 GB, Intel Arc, shared memory); the other two take its number until measured
    'dml': {'birefnet-general-lite': 25.0, 'birefnet-general': 25.0, 'birefnet-portrait': 25.0},
}

def matte_providers():
    try:
        import onnxruntime as ort
    except ImportError:
        return ['CPUExecutionProvider']
    have = ort.get_available_providers()
    return [p for p in ('CUDAExecutionProvider', 'DmlExecutionProvider', 'CoreMLExecutionProvider', 'CPUExecutionProvider') if p in have]

def matte_need_gb(model, provider=None):
    name = MATTE_MODELS.get(model)
    if not name:
        return 0.5
    if provider is None:
        provider = matte_providers()[0]
    # CUDA and CoreML have not been measured and use the CPU peaks.
    peaks = MATTE_PEAK_GB['dml' if provider == 'DmlExecutionProvider' else 'cpu']
    return round(peaks[name] + 0.8, 1)

def avail_gb():
    """Memory the OS can hand out now, in GB (Linux MemAvailable, Windows ullAvailPhys, macOS free + inactive), or None."""
    try:
        if sys.platform.startswith('linux'):
            for line in open('/proc/meminfo', encoding="utf-8"):
                if line.startswith('MemAvailable:'):
                    return int(line.split()[1]) / 1048576
        elif sys.platform == 'win32':
            import ctypes
            class MS(ctypes.Structure):
                _fields_ = [('dwLength', ctypes.c_ulong), ('dwMemoryLoad', ctypes.c_ulong), ('ullTotalPhys', ctypes.c_ulonglong), ('ullAvailPhys', ctypes.c_ulonglong),
                            ('ullTotalPageFile', ctypes.c_ulonglong), ('ullAvailPageFile', ctypes.c_ulonglong), ('ullTotalVirtual', ctypes.c_ulonglong),
                            ('ullAvailVirtual', ctypes.c_ulonglong), ('ullAvailExtendedVirtual', ctypes.c_ulonglong)]
            m = MS(); m.dwLength = ctypes.sizeof(MS); ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return m.ullAvailPhys / 1073741824
        elif sys.platform == 'darwin':
            import subprocess, re
            out = subprocess.run(['vm_stat'], capture_output=True, text=True).stdout
            ps = int(re.search(r'page size of (\d+)', out).group(1))
            pages = sum(int(re.search(k + r':\s+(\d+)', out).group(1)) for k in ('Pages free', 'Pages inactive', 'Pages speculative'))
            return pages * ps / 1073741824
    except Exception:
        return None
    return None
_MEAN = np.array([0.485, 0.456, 0.406], np.float32)
_STD = np.array([0.229, 0.224, 0.225], np.float32)

def matte_weights(model):
    """Path of the cached ONNX for a matte model (rembg's cache: $U2NET_HOME, else ~/.u2net), downloading it through
    rembg on first use. rembg verifies its published checksum."""
    name = MATTE_MODELS[model]
    from rembg import new_session  # noqa: F401  (registers the sessions)
    import importlib
    mod = importlib.import_module('rembg.sessions.' + name.replace('-', '_'))
    return str(_session_class(mod, name).download_models())

def _session_class(mod, name):
    return next(v for k, v in vars(mod).items() if isinstance(v, type) and k.startswith('BiRefNet') and getattr(v, 'name', None) and v.name() == name)

def cached_weights(model):
    name = MATTE_MODELS.get(model)
    if not name:
        return None
    try:
        import importlib
        mod = importlib.import_module('rembg.sessions.' + name.replace('-', '_'))
        cls = _session_class(mod, name)
        return cls.resolve_existing(f"{cls.name()}.onnx")
    except Exception:
        return None

class Matter:
    """BiRefNet on ONNX Runtime, on the GPU when ONNX Runtime has a provider for it (DirectML, CUDA, CoreML), else the CPU.
    Our own pre and post step instead of rembg's predict(): rembg stretches every frame's matte to its own min and max,
    which makes the matte breathe from frame to frame when the person fills more or less of the shot; here it is the
    plain sigmoid. One portrait frame peaked at 7.5 GB on the CPU with the memory settings below."""
    def __init__(self, model='birefnet-portrait'):
        import onnxruntime as ort
        self.model = MATTE_MODELS[model]
        prov = matte_providers()
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        # memory: no arena (it kept every activation size ever seen and grew past 15 GB), no memory pattern, and no
        # prepacked weight copies (7.5 GB peak instead of 7.9, and about 10% faster on the CPU). Batch size is 1.
        so.enable_cpu_mem_arena = False
        so.enable_mem_pattern = False
        so.add_session_config_entry('session.disable_prepacking', '1')
        self.inner_session = ort.InferenceSession(matte_weights(model), so, providers=prov)
        self.input = self.inner_session.get_inputs()[0].name
    @property
    def provider(self):
        return self.inner_session.get_providers()[0]
    def raw(self, rgb):
        x = cv2.resize(rgb, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255
        x = ((x - _MEAN) / _STD).transpose(2, 0, 1)[None]
        o = self.inner_session.run(None, {self.input: np.ascontiguousarray(x)})[0][0, 0]
        a = 1 / (1 + np.exp(-o.astype(np.float32)))
        if a.shape != rgb.shape[:2]:
            a = cv2.resize(a, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
        return np.clip(a, 0, 1).astype(np.float32)

def matte_session(model='birefnet'):
    """A Matter for a model name in MATTE_MODELS. Measured on an 8-core CPU (no GPU) at 1080x1920, per frame:
    birefnet-general-lite 6.6 s, birefnet-portrait 9.0 s, birefnet-general about the same as portrait (same network).
    On an Intel Arc B390 through DirectML (earlier measurement through rembg): lite 0.98 s, portrait 1.94 s."""
    return Matter(model)

def matte_raw(session, rgb):
    """Float 0..1 matte for one RGB frame, at the frame's size, before any cleanup."""
    return session.raw(rgb)
