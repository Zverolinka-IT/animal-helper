// All report types persist through the command client; presentation state stays local.
export {
  previewAccess,
  previewAnimalCatalogue,
  previewAnimalGroupsView,
  previewContactView,
  previewDetailsView,
  previewHomeView,
  previewLocationView,
  previewMediaView,
  previewThankYouView
} from './pages/fixtures/preview-server'
export { walkFlowActions as flowActions } from './walk/adapter'

import { previewPageAdvice as fixturePageAdvice } from './pages/fixtures/preview-server'
import { walkFlowActions } from './walk/adapter'
export const previewPageAdvice = (screen: unknown) =>
  walkFlowActions.advicePanel(fixturePageAdvice(screen === 'contact-option' ? 'W15' : screen))
