# Showcase source frame

`presenter.jpg` is an AI-generated fictional person made for this project, so the gallery can show finishes, titles behind the head, and effects on a photoreal talking-head frame. It is not a portrait of a real person and carries no third-party stock or likeness rights. Licensed Apache-2.0 with the repo.

The file is 1080x1920 (upscaled with lanczos from the original 9:16 still). `presenter-mask.png` is the person mask produced by `kit/mask.py --model birefnet`. Rebuild the mask with `npm run showcase -- --refresh-mask` if you replace the still.
