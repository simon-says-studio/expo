---
'@expo/cli': patch
---

Reuse the resolved runtime version between dev server manifest requests until a project input changes, instead of running `runtimeversion:resolve` (a full fingerprint under the `fingerprint` policy) on every request.
