# Other entry — working presentation contract

## Server-owned flow

The paths below are preview scenarios, not production client business rules. `pages/fixtures/preview-server.ts`
simulates server selection of the view, navigation targets and draft-dependent availability. Routes register pages and
consume this adapter; replace the adapter with validated API responses when integrating the backend. The server owns
which questions, content and next actions apply. The client owns supported rendering, interaction, accessibility,
transitions and navigation history. Local draft updates and guards are preview conveniences, not server-side validation
or authorization. Action targets must resolve to supported application routes; responses must not execute arbitrary code
or URLs.

W32 is immediately after Home → Other, before location. The offered choice is the general situation, which continues to
identification and W39 thanks, without advice. Road/rail and human-activity choices are not offered while those branches
are paused. Their screens remain:

- Road/rail → W03 → W33 situation radios → W36 instruction preview.
- Trapped/human activity → W03 → W04/W06 identification → W09 using W34 data → advice and contacts.

Road instructions allow success → W24 without requiring species identification. Failure → W37 optional multiple reasons
and Other textarea → W04 identification → W09 using W35 data → W39. Location is preserved and not requested again, per
wireframe annotation. W37 copy reflects this rather than the stale visual location text.

The visual Other section has mislabeled W27/W30 frames; wireframe IDs are W32/W37. The W37 expanded state reuses the
same form, not an additional route.

Copy, choices, questions and footer actions live in presentation fixtures. Existing details and instructions renderers
are reused. `otherSituation`, `otherReport` and `documentingOther` are local preview state, reset when selecting a
different branch. The backend will validate answers and decide the appropriate service and next view. Road instructions
currently show an explicitly labeled patrol showcase for every answer: no live numbers and no real emergency routing.
Submission and AI remain unconnected. The 2000-character limit is provisional.
