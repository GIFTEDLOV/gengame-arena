# Pin gltest Direct Mode to v0.2.16 — v0.3.0-rc0 dropped genvm-universal.tar.xz
from gltest.direct import sdk_loader
sdk_loader.get_latest_version = lambda: "v0.2.16"
