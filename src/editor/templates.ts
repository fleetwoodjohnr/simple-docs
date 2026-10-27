import type { JSONContent } from '@tiptap/core'

// Built-in starting points. Content only; page setup and styles come from the user's defaults.

const t = (text: string, marks?: JSONContent['marks']): JSONContent => (marks ? { type: 'text', text, marks } : { type: 'text', text })
const p = (text = '', attrs?: Record<string, unknown>): JSONContent => ({ type: 'paragraph', ...(attrs ? { attrs } : {}), ...(text ? { content: [t(text)] } : {}) })
const h = (level: number, text: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [t(text)] })
const bullets = (...items: string[]): JSONContent => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: [p(i)] })) })
const tasks = (...items: string[]): JSONContent => ({ type: 'taskList', content: items.map((i) => ({ type: 'taskItem', attrs: { checked: false }, content: [p(i)] })) })
const bold = (s: string) => t(s, [{ type: 'bold' }])

function table(rows: string[][]): JSONContent {
  return {
    type: 'table',
    content: rows.map((r, ri) => ({
      type: 'tableRow',
      content: r.map((c) => ({ type: ri === 0 ? 'tableHeader' : 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [p(c)] }))
    }))
  }
}

const today = () => new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

export interface Template {
  id: string
  name: string
  description: string
  accent: string
  build: () => JSONContent[]
}

export const TEMPLATES: Template[] = [
  { id: 'blank', name: 'Blank document', description: 'Start from an empty page', accent: '#a1a1aa', build: () => [p()] },
  {
    id: 'report',
    name: 'Report',
    description: 'Title, summary, sections and a data table',
    accent: '#5b5bd6',
    build: () => [
      p('Project Report', { styleId: 'Title' }),
      p(`Prepared ${today()}`, { styleId: 'Subtitle' }),
      h(1, 'Executive summary'),
      p('Summarize the purpose, key findings and recommendations in a few sentences. Readers who stop here should still understand the outcome.'),
      h(1, 'Background'),
      p('Describe the context and the question this report answers.'),
      h(1, 'Findings'),
      h(2, 'Key metrics'),
      table([
        ['Metric', 'Target', 'Actual'],
        ['Adoption', '60%', '—'],
        ['Satisfaction', '4.5', '—'],
        ['Cost', '$120k', '—']
      ]),
      p(''),
      h(2, 'Observations'),
      bullets('First observation', 'Second observation', 'Third observation'),
      h(1, 'Recommendations'),
      { type: 'orderedList', attrs: { start: 1 }, content: ['Recommendation one', 'Recommendation two'].map((x) => ({ type: 'listItem', content: [p(x)] })) }
    ]
  },
  {
    id: 'letter',
    name: 'Letter',
    description: 'A formal business letter',
    accent: '#0891b2',
    build: () => [
      p('Your Name', { spaceAfter: 0 }),
      p('Street Address', { spaceAfter: 0 }),
      p('City, State ZIP', { spaceAfter: 24 }),
      p(today(), { spaceAfter: 24 }),
      p('Recipient Name', { spaceAfter: 0 }),
      p('Company', { spaceAfter: 0 }),
      p('Address', { spaceAfter: 24 }),
      p('Dear Recipient,'),
      p('Begin with the reason you are writing. Keep the opening short and specific.', { align: 'justify' }),
      p('Use the body to provide the details, and close with the action you would like the reader to take.', { align: 'justify' }),
      p('Sincerely,', { spaceBefore: 12, spaceAfter: 36 }),
      p('Your Name')
    ]
  },
  {
    id: 'notes',
    name: 'Meeting notes',
    description: 'Agenda, discussion and action items',
    accent: '#059669',
    build: () => [
      p('Meeting Notes', { styleId: 'Title' }),
      { type: 'paragraph', content: [bold('Date: '), t(today())] },
      { type: 'paragraph', content: [bold('Attendees: '), t('Names')] },
      h(2, 'Agenda'),
      { type: 'orderedList', attrs: { start: 1 }, content: ['Updates', 'Discussion', 'Next steps'].map((x) => ({ type: 'listItem', content: [p(x)] })) },
      h(2, 'Discussion'),
      p('Notes from the meeting.'),
      h(2, 'Action items'),
      tasks('Owner — action — due date', 'Owner — action — due date')
    ]
  },
  {
    id: 'resume',
    name: 'Résumé',
    description: 'Clean one-page résumé',
    accent: '#d97706',
    build: () => [
      p('Your Name', { styleId: 'Title', align: 'center' }),
      p('email@example.com · (555) 123-4567 · City, Country', { styleId: 'Subtitle', align: 'center' }),
      h(2, 'Experience'),
      { type: 'paragraph', content: [bold('Job Title'), t(' — Company, 2022–present')] },
      bullets('Achievement with a measurable result', 'Another achievement'),
      { type: 'paragraph', content: [bold('Job Title'), t(' — Company, 2019–2022')] },
      bullets('Achievement with a measurable result'),
      h(2, 'Education'),
      { type: 'paragraph', content: [bold('Degree'), t(' — University, Year')] },
      h(2, 'Skills'),
      p('Skill · Skill · Skill · Skill')
    ]
  },
  {
    id: 'essay',
    name: 'Essay',
    description: 'Double-spaced academic paper',
    accent: '#db2777',
    build: () => [
      p('Title of the Essay', { align: 'center', spaceAfter: 0, lineHeight: 2 }),
      p('Author · Course · Date', { align: 'center', lineHeight: 2 }),
      ...['Introduce the topic and state the thesis.', 'Develop the first argument with evidence.', 'Address a counterargument.', 'Conclude by restating the thesis in light of the evidence.'].map((x) =>
        p(x, { lineHeight: 2, indentFirst: 36, spaceAfter: 0 })
      )
    ]
  }
]

export function welcomeDoc(): JSONContent[] {
  return [
    p('Welcome to Simple Docs', { styleId: 'Title' }),
    p('A fast, focused word processor that works offline.', { styleId: 'Subtitle' }),
    h(1, 'Getting started'),
    bullets('Use the ribbon above, or select text for the floating toolbar.', 'Ctrl/⌘ + Enter inserts a page break; content flows across real pages.', 'Save as DOCX, ODT, Markdown, HTML or text, and export to PDF.')
  ]
}

// ---------- cover pages ----------
// Built from ordinary styled paragraphs and a page break, so they survive DOCX/ODT round trips.

export interface CoverInfo {
  title: string
  subtitle: string
  author: string
}

const run = (text: string, marks: JSONContent['marks']) => (text ? [t(text, marks)] : undefined)
const color = (c: string) => ({ type: 'textStyle', attrs: { color: c } })

export const COVER_PAGES: { id: string; name: string; build: (c: CoverInfo) => JSONContent[] }[] = [
  {
    id: 'classic',
    name: 'Classic (centered)',
    build: (c) => [
      p(c.title, { styleId: 'Title', align: 'center', spaceBefore: 200 }),
      p(c.subtitle, { styleId: 'Subtitle', align: 'center' }),
      p(c.author, { align: 'center', spaceBefore: 260 }),
      p(today(), { align: 'center' }),
      { type: 'pageBreak' }
    ]
  },
  {
    id: 'band',
    name: 'Color band',
    build: (c) => [
      // A borderless one-cell table gives a padded color band.
      {
        type: 'table',
        attrs: { tableStyle: 'plain' },
        content: [
          {
            type: 'tableRow',
            content: [
              {
                type: 'tableCell',
                attrs: { background: '#3f3fb0' },
                content: [
                  { type: 'paragraph', attrs: { styleId: 'Title', spaceBefore: 150 }, content: run(c.title, [color('#ffffff')]) },
                  { type: 'paragraph', attrs: { styleId: 'Subtitle', spaceAfter: 18 }, content: run(c.subtitle, [color('#dcdcff')]) }
                ]
              }
            ]
          }
        ]
      },
      p(c.author, { spaceBefore: 300 }),
      p(today()),
      { type: 'pageBreak' }
    ]
  },
  {
    id: 'minimal',
    name: 'Minimal',
    build: (c) => [
      { type: 'paragraph', content: run(today(), [{ type: 'textStyle', attrs: { color: '#595966', smallCaps: true } }]) },
      p(c.title, { styleId: 'Title', spaceBefore: 280 }),
      p(c.subtitle, { styleId: 'Subtitle' }),
      p(c.author, { spaceBefore: 24 }),
      { type: 'pageBreak' }
    ]
  }
]
