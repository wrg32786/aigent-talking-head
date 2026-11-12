"""Download ONE Instagram post (reel, post or IGTV) the user names, anonymously, for teardown.

    python kit/ig_fetch.py <shortcode> <out_dir>

Optional helper for `npm run teardown -- --url <instagram post url>`. Needs instaloader (MIT,
https://github.com/instaloader/instaloader): pip install instaloader. It never logs in, never reads a
session file, and fetches a single post only: no profiles, hashtags, stories or bulk downloads.
Only use it on content you have the rights to, and follow Instagram's terms.
Prints the path of the downloaded mp4 on the last line.
"""
import os
import sys


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: ig_fetch.py <shortcode> <out_dir>")
    shortcode, out_dir = sys.argv[1], sys.argv[2]
    try:
        import instaloader
    except ImportError:
        sys.exit("instaloader is not installed. It is optional: pip install instaloader")
    os.makedirs(out_dir, exist_ok=True)
    L = instaloader.Instaloader(
        dirname_pattern=out_dir, filename_pattern="{shortcode}",
        download_pictures=False, download_videos=True, download_video_thumbnails=False,
        download_geotags=False, download_comments=False, save_metadata=False,
        compress_json=False, post_metadata_txt_pattern="", quiet=True, max_connection_attempts=1)
    try:
        post = instaloader.Post.from_shortcode(L.context, shortcode)
        if not post.is_video:
            sys.exit(f"post {shortcode} has no video")
        L.download_post(post, target=shortcode)
    except (instaloader.exceptions.LoginRequiredException, instaloader.exceptions.ConnectionException,
            instaloader.exceptions.QueryReturnedBadRequestException) as e:
        sys.exit(f"Instagram refused the anonymous download ({type(e).__name__}: {e}). "
                 "This helper does not log in. Download the video yourself where you have the rights, then pass the file.")
    vids = sorted(f for f in os.listdir(out_dir) if f.startswith(shortcode) and f.endswith(".mp4"))
    if not vids:
        sys.exit(f"no video was saved for {shortcode}")
    print(os.path.join(out_dir, vids[0]))


if __name__ == "__main__":
    main()
