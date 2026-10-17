// Birthday titles (#10): the Cumpleaños setting (birthdays.tidyTitles) and the Filtros preview line that says why a
// title on screen is not the calendar's, without striking anything through.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig, mergeDefaults } from '../core/validate.js';
import { defaultConfig } from '../core/defaults.js';
import { loadWebModules } from './webModules.js';

test('config: birthdays.tidyTitles is on by default and for configs saved before it, and must be a boolean', () => {
  assert.equal(defaultConfig().birthdays.tidyTitles, true);
  const old = defaultConfig();
  delete old.birthdays.tidyTitles;
  assert.equal(validateConfig(mergeDefaults(old)).value.birthdays.tidyTitles, true);
  const off = defaultConfig();
  off.birthdays.tidyTitles = false;
  assert.equal(validateConfig(off).value.birthdays.tidyTitles, false);
  const bad = defaultConfig();
  bad.birthdays.tidyTitles = 'no';
  assert.deepEqual(validateConfig(bad).errors.map((e) => e.path), ['birthdays.tidyTitles']);
});

test('Filtros preview: a recognised birthday, a rename rule, capitals; the original title as it is', async () => {
  // setLang writes <html lang>: a stand-in document is enough here
  globalThis.document ??= { documentElement: {} };
  const [{ titleNote }, i18n] = await loadWebModules('/web/admin/titleNote.ts', '/web/admin/i18n.ts');
  const rules = [{ id: 'f_a' }, { id: 'f_b' }];
  const ev = (over) => ({ title: 'Astrid', originalTitle: "Astrid's Birthday", titleWhy: 'birthday', applied: [], ...over });
  i18n.setLang('es');
  assert.deepEqual(titleNote(ev(), rules), { lead: 'Cumpleaños reconocido', original: "Astrid's Birthday" });
  assert.deepEqual(titleNote(ev({ title: 'Cita médico', originalTitle: 'Cita X', titleWhy: 'rule', applied: [{ ruleId: 'f_b', action: 'rename' }] }), rules), { lead: 'Renombrado por la regla #2', original: 'Cita X' });
  assert.deepEqual(titleNote(ev({ title: 'Maria', originalTitle: 'MARIA', titleWhy: 'caps' }), rules), { lead: 'Sin mayúsculas', original: 'MARIA' });
  // an older server (no titleWhy) and a rule that is gone: just the original title
  assert.deepEqual(titleNote(ev({ titleWhy: undefined }), rules), { lead: '', original: "Astrid's Birthday" });
  assert.equal(titleNote(ev({ title: "Astrid's Birthday" }), rules), null);
  i18n.setLang('en');
  assert.equal(titleNote(ev(), rules).lead, 'Birthday recognised');
  i18n.setLang('da');
  assert.equal(titleNote(ev(), rules).lead, 'Fødselsdag genkendt');
  assert.equal(i18n.t('título original'), 'oprindelig titel');
  i18n.setLang('nl');
  assert.equal(titleNote(ev({ titleWhy: 'rule', applied: [{ ruleId: 'f_a', action: 'rename' }] }), rules).lead, 'Hernoemd door regel #1');
  i18n.setLang('pt');
  assert.equal(i18n.t('Ordenar los títulos de cumpleaños'), 'Arrumar os títulos dos aniversários');
});
