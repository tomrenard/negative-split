// Runs the fixture race and reports its hash to the dev server, which compares it with Node's.
import { fixtureHash } from './field.ts'

const hash = fixtureHash()
document.getElementById('out')!.textContent = hash
fetch('/report', { method: 'POST', body: JSON.stringify({ hash, ua: navigator.userAgent }) })
