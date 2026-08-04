# Policy Overlays

Policy is resolved in one direction:

`kit defaults → organization → team → repository → task capability`

Every external overlay must be a signed, versioned bundle with an explicit kit
compatibility range. Each effective rule retains its bundle, layer, and version
as provenance. A higher layer may refine a rule unless an earlier layer locks
that rule. Locked conflicts, duplicate layers, invalid signatures, and
unsupported compatibility ranges block activation with an actionable error.
Signatures are accepted only when the key is active in the repository trust
store and authorized for that layer; embedding an unknown public key in a
bundle does not grant authority.

Distribution is Git-native and offline. Repository-owned policy remains in the
repository and survives kit or organization updates. No hosted account is
required.
