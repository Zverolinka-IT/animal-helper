# Slovakia (`SK`)

Initial jurisdiction pack for the Slovak Republic.

Authoritative seed sources to review during implementation:

- [ŠVPS submission portal](https://podania.svps.sk/index.php?id=2&page=podnety)
  for veterinary/food-administration submissions and Regional Veterinary and
  Food Administration routing;
- [ŠVPS contacts](https://svps.sk/kontakt/) for the current regional directory;
- [ŠOP SR rescue-facility map](https://www.sopsr.sk/web/?cl=57najdite) for
  injured wildlife.

Internal routing keys derived from the case matrices (`rvps`, `rvps_sizp`,
`sop_rescue`, `municipality_capture`, and others) live in
`@animal-helper/guidance`. Directory entries are administered through
`/contacts`; immutable releases live in `ah.contact_directory_revisions`.
Enabled entries require a source URL, verification date and review deadline.
Publication audit records the operator, and each guidance revision pins the
directory release.

Do not copy addresses or forms without recording source URL, retrieval date,
effective date if known, reviewer, and version. Authority data can change
between releases and must be administrator-reviewable before dispatch.
