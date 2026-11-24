import routes from './injured-routes.json' with { type: 'json' }

type RouteRecord = {
  warning: 'W13' | 'W14' | null
  avoid: string[]
  do: string[]
  askConscious: boolean
  askJuvenile: boolean
  collision: boolean
  first: 'W15' | 'W15a' | 'W15b' | 'W15c' | 'W15d' | null
  police: 'W15e' | 'W15f' | null
  second: 'W18' | 'W20a' | null
  volunteers: boolean
  selfHelp: 'W22a' | 'W22b' | 'W22d' | null
  helped: string[]
  help: string[]
  gameWarning: string[]
  gameSpecies: string[]
  photos?: string[]
}

const table = routes as Record<string, RouteRecord>

export type InjuredRoute = RouteRecord

export function injuredRouteFor(kindKey: string | undefined): InjuredRoute | undefined {
  if (!kindKey) return undefined
  return table[kindKey]
}

// Without a municipality match, use the branch for places that do not have their own police.
export function injuredScreens(
  route: InjuredRoute,
  options: { collision: boolean; municipalPolice: boolean }
): string[] {
  const screens: string[] = []
  if (route.warning) screens.push(route.warning)
  if (route.collision && options.collision) screens.push('W20b')
  if (route.first) screens.push(options.municipalPolice && route.police ? route.police : route.first)
  if (route.second) screens.push(route.second)
  if (route.volunteers) screens.push('W21')
  if (route.selfHelp) screens.push(route.selfHelp)
  return screens
}

const headingLetters = /[A-Za-zÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽáäčďéíĺľňóôŕšťúýž]/g

function isHeading(line: string) {
  const letters = line.match(headingLetters)?.join('') ?? ''
  return letters.length > 0 && letters === letters.toLocaleUpperCase('sk')
}

function splitLeadHeading(line: string) {
  const match = line.match(/^(.+?)\s+([A-ZÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ][a-záäčďéíĺľňóôŕšťúýž].*)$/)
  if (!match) return [line]
  const heading = match[1].trim()
  return isHeading(heading) ? [heading, match[2].trim()] : [line]
}

function sentenceCase(line: string) {
  const lower = line.toLocaleLowerCase('sk')
  return lower.charAt(0).toLocaleUpperCase('sk') + lower.slice(1)
}

export function injuredHelpSections(lines: string[]): { title: string; paragraphs: string[] }[] {
  const sections: { title: string; paragraphs: string[] }[] = []
  let current: { title: string; paragraphs: string[] } | undefined
  for (const raw of lines.flatMap(splitLeadHeading)) {
    const line = raw.trim()
    if (!line) continue
    if (isHeading(line)) {
      current = { title: sentenceCase(line), paragraphs: [] }
      sections.push(current)
    } else if (current) current.paragraphs.push(line)
    else {
      current = { title: '', paragraphs: [line] }
      sections.push(current)
    }
  }
  return sections
}

export function nextInjuredScreen(
  kindKey: string | undefined,
  current: string,
  options: { collision: boolean; municipalPolice: boolean }
): string | undefined {
  const route = injuredRouteFor(kindKey)
  if (!route) return undefined
  const screens = injuredScreens(route, options)
  if (!screens.length) return undefined
  if (current === 'W09') return screens[0]
  const index = screens.indexOf(current)
  if (index === -1) return undefined
  return screens[index + 1] ?? 'W25'
}
