import type { AdvicePanel } from './advice'
import type { ContactBlock } from './contacts'
import type { SelfHelpBlock } from './self-help'

export type InstructionBlock = ContactBlock | SelfHelpBlock
export type InstructionAction = {
  id: 'resolved' | 'unresolved' | 'alternatives'
  label: string
  appearance: 'primary' | 'secondary'
  target: 'W15' | 'W22' | 'W22a' | 'W24' | 'W25' | 'W37' | 'W39a'
}
export type InstructionsView = {
  flowPath?: `/contacts/${string}`
  screen:
    | 'W15'
    | 'W15a'
    | 'W15b'
    | 'W15c'
    | 'W15d'
    | 'W15e'
    | 'W15f'
    | 'W18'
    | 'W19'
    | 'W20'
    | 'W20a'
    | 'W20b'
    | 'W21'
    | 'W36'
    | 'W22'
    | 'W22a'
    | 'W22b'
    | 'W22d'
  locale: string
  layout: { showMenu: boolean }
  advice?: AdvicePanel & { triggerLabel: string }
  backTarget: string
  allowedActions: ('back' | InstructionAction['id'])[]
  footerActions: InstructionAction[]
  copy: { back: string; title: string; description: string; preview: string; unavailable: string }
  blocks: InstructionBlock[]
}
