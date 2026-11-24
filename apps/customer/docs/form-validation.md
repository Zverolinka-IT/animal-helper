# Form validation responses

Forms may include `validation: { formErrors?: string[], fieldErrors?: Record<string, string[]> }`. These messages
describe a rejected submission; they are plain text, never HTML. Injured and stray reports use the validated command
API. The remaining situation flows still use the fixture provider.

## Field keys

| View                                             | Field key                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| Animal details                                   | Question ID; `questionId:optionId` for an option description                     |
| Thank you                                        | Contact field ID; `reason:optionId`, `description:optionId`, `consent:consentId` |
| Manual identification                            | `animal` for the selection; `description` for other animal text                  |
| Unsuccessful report (cruelty or other situation) | `reasons`, `description`                                                         |

The response must reference existing, visible, enabled fields. Do not send field errors for disabled or hidden controls:
put non-actionable/general failures in `formErrors`. Keep IDs stable and unique within the form.

The client retains the user's current values when validation changes, links errors using `aria-describedby`, highlights
invalid controls and focuses the first error on attempted confirmation. Editing a field clears its response errors, not
other fields' errors; the general summary clears because the draft no longer matches the rejected submission. Native
required/format checks still apply. Clearing a message does **not** establish server validity: the command API must
revalidate every submission and authorize commands and state transitions.

Form-level errors alone permit retry. Field errors prevent local completion until edited or replaced by a new response.
Field-level errors are supported by the renderers; command failures currently appear through the walk adapter. Any
future field-error response must reference validated keys.

## Development preview

Normal thank-you variants start with empty optional contact fields and no validation errors. Validation examples belong
in component test fixtures. Injured and stray submissions carry the reported outcome and selected failure reasons in the
private form snapshot, queued with contact data before submission. Only the checked Other reason carries its text.
Detail questions are optional; selecting Other does not require a description.

Route access and commands still use the existing preview flow/allowed-actions mechanism. This change prepares error
presentation only; it is not an authoritative server-contract state machine.
