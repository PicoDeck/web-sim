#ifndef WEB_INTERNAL_H
#define WEB_INTERNAL_H

// Shared by this repo's platform sources only (not part of PicoDeck's seam).

// The SD image's root in the browser's filesystem, as web_fs_init() got it
// ("/sd").
const char *web_sd_root(void);

#endif
