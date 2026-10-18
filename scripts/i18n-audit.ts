/**
 * Translation audit (npm run i18n:audit). Walks every page and component and
 * the server messages people see, and reports text that:
 *   A  is shown without passing through translation at all, or
 *   B  is translated, but has no Malay entry, so it shows in English.
 * tests/i18n.test.ts fails on any finding that is not in ALLOWED below.
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { pathToFileURL } from 'node:url';
import { translateMessage } from '../src/lib/i18n-core';

const walk = (dir: string, ext: RegExp): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name), ext) : ext.test(d.name) ? [path.join(dir, d.name)] : []));

// Components that pass their children (strings) through <Text>.
const TRANSLATING_PARENTS = new Set(['Text', 'Button', 'Badge', 'EmptyState', 'Select', 'ConfirmDialog', 'Modal', 'Drawer', 'Toast', 'Stat', 'CardHeader', 'PageHeader', 'Async', 'PreviewBadge', 'SimulatedNote', 'Tab', 'TabPanel', 'Label']);
// Props that shared components translate.
const TRANSLATED_PROPS = new Set(['label', 'hint', 'error', 'title', 'description', 'placeholder', 'aria-label', 'aria-description', 'alt', 'confirmLabel', 'success', 'gloss', 'text', 'subtitle', 'action', 'data-label']);
// On plain HTML tags these attributes are shown, but only Localized* elements translate them.
const HTML_SHOWN_ATTRS = new Set(['placeholder', 'title', 'aria-label', 'alt']);

const hasWords = (s: string) => /[A-Za-z]{2,}/.test(s) && !/^[a-z0-9_./:#?=&-]+$/.test(s) && !/^[A-Z0-9_]+$/.test(s);
const looksLikeCode = (s: string) => /^(\/|https?:|mailto:|tel:|#|\.|@)/.test(s) || /^[a-z]+([A-Z][a-z]+)+$/.test(s) || /\b(px|rem|vh|vw)\b/.test(s) || /^[\w-]+(\s[\w-:/[\]]+)*$/.test(s) && /\b(flex|grid|text-|bg-|border|rounded|p[xy]?-|m[xy]?-|gap-|w-|h-|size-)/.test(s);
const translated = (s: string) => translateMessage('ms', s) !== s;
/** A template literal as the catalogue writes it, with a sample value to test the match. */
function templateForms(node: ts.TemplateExpression): { pattern: string; sample: string } {
  let pattern = node.head.text;
  let sample = node.head.text;
  node.templateSpans.forEach((span, i) => {
    pattern += `{${i}}` + span.literal.text;
    sample += `7` + span.literal.text;
  });
  return { pattern, sample };
}


export interface Finding {
  kind: 'A' | 'B';
  file: string;
  line: number;
  text: string;
  why: string;
}

/**
 * Text that is meant to read the same in both languages, or that no resident
 * sees, so it needs no Malay entry. Keep each one deliberate.
 */
export const ALLOWED = new Set([
  // Feature and brand names, the same in Malay.
  'Akses+', 'Banjir', 'Gerak', 'Jimat', 'Jiran', 'Kitar', 'Kongsi', 'Lapor', 'Tamu', 'Taman', 'SimeTown', 'SimeTown Home', 'SimeTown Recycle',
  'Google Maps', 'Sime Darby Property', 'Kafe Seri Pagi', 'Kedai Runcit Mesra', 'SimeTown · Township App for all',
  // Words and templates that are identical in Malay.
  'SOS', 'SOS ·', 'Status', 'Planet', 'Menu', 'INC-000123',
  // Demo sponsor and shop names, and image sizes.
  'XP', 'Demo', 'Solar Cerah', 'Basikal Bersama', 'Kopi Hijau', 'Kitar Plus Recyclers', 'Tuai Segar Market', 'Nurseri Rimbun', 'Aktif Elmina Fitness', 'Roti Desa Bakery', 'Farmasi Elmina Sihat', 'Dobi Bersih Laundry', 'Kedai Bunga Melati', 'Perkakasan Jaya', 'Bengkel Basikal Roda', '(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw', '(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw', 'Puan Rahmah', '(min-width: 1024px) 58vw, 100vw', 'Poster', 'Shopee Express', 'Pos Laju', 'Ninja Van', '{0} min', 'Simulator', 'Simulator: {0}', 'Plot {0}', 'AI · {0}', '{0} kWh', ', minimum {0}',
  // Elmina place names and kiosk names (Kitar Map tab), the same in Malay.
  'Elmina Gardens', 'Elmina Valley', 'Elmina Valley 1', 'Elmina Valley 2', 'Elmina Green', 'Elmina West', 'Kiosk Elmina Gardens', 'Kiosk Elmina Valley',
  // Already Malay, on purpose: the place name, a Malay suggestion and the Malay voice sample.
  'Tasik', 'Bila kutipan sampah?', 'Ini contoh suara SimeTown.',
  // The language switch always names the other language in that language.
  'Switch to English', 'Tukar ke Bahasa Malaysia',
  // Translated through the full phrases (Low urgency, …) or a restricted template.
  '{0} urgency', '{0} is {1}',
  // Not shown to residents: developer errors, the machine API, the AI's own context, CSS.
  'Google Maps loaded without the maps library.', 'Google Maps could not be loaded.', 'An HMAC-SHA256 signature in hex.',
  'The AI service sent an empty answer.', 'The AI did not finish within {0} steps.',
  'One action at a time. The resident is already being asked to confirm another.', '(The township office replied:) {0}',
  '(prefers-reduced-motion: reduce)', '(min-width: 1024px) 64vw, 100vw', '(min-width: 1024px) 55vw, 100vw',
  // A regular expression shown as an example, a unit, and a developer error in the barcode encoder.
  'JT[0-9]{12}', 'ms', 'Code 128 B encodes printable ASCII only.',
]);

export function auditTranslations(ROOT = process.cwd()): Finding[] {
  const findings: Finding[] = [];

  const add = (kind: 'A' | 'B', sf: ts.SourceFile, node: ts.Node, text: string, why: string) => {
    const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    findings.push({ kind, file: path.relative(ROOT, sf.fileName).replace(/\\/g, '/'), line, text: text.replace(/\s+/g, ' ').trim(), why });
  };

  const tagName = (n: ts.JsxOpeningElement | ts.JsxSelfClosingElement) => n.tagName.getText();
  function enclosingTag(node: ts.Node): string | null {
    for (let p: ts.Node | undefined = node.parent; p; p = p.parent) {
      if (ts.isJsxElement(p)) return tagName(p.openingElement);
      if (ts.isJsxFragment(p)) continue;
      if (ts.isJsxExpression(p) || ts.isConditionalExpression(p) || ts.isBinaryExpression(p) || ts.isParenthesizedExpression(p)) continue;
      return null;
    }
    return null;
  }

  function checkText(sf: ts.SourceFile, node: ts.Node, text: string, context: 'child' | 'prop' | 'message', parent: string | null) {
    if (!hasWords(text) || looksLikeCode(text)) return;
    if (context === 'child' && parent && !TRANSLATING_PARENTS.has(parent)) {
      add('A', sf, node, text, `inside <${parent}> without <Text>`);
      return;
    }
    if (!translated(text)) add('B', sf, node, text, context === 'message' ? 'server message' : `no Malay entry${parent ? ` (<${parent}>)` : ''}`);
  }

  function checkTemplate(sf: ts.SourceFile, node: ts.TemplateExpression, context: 'child' | 'prop' | 'message', parent: string | null) {
    const { pattern, sample } = templateForms(node);
    if (!hasWords(pattern.replace(/\{\d+\}/g, ''))) return;
    if (context === 'child' && parent && !TRANSLATING_PARENTS.has(parent)) {
      add('A', sf, node, pattern, `inside <${parent}> without <Text>`);
      return;
    }
    if (!translated(sample)) add('B', sf, node, pattern, context === 'message' ? 'server message (template)' : 'no Malay template');
  }

  // --- Pages and components -----------------------------------------------------------------
  for (const file of [...walk(path.join(ROOT, 'src/app'), /\.tsx$/), ...walk(path.join(ROOT, 'src/components'), /\.tsx$/)]) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) {
        const text = node.text;
        if (hasWords(text)) checkText(sf, node, text, 'child', enclosingTag(node));
      } else if (ts.isJsxAttribute(node) && node.initializer) {
        const name = node.name.getText();
        const owner = node.parent.parent as ts.JsxOpeningElement | ts.JsxSelfClosingElement;
        const tag = tagName(owner);
        const value = ts.isStringLiteral(node.initializer) ? node.initializer : ts.isJsxExpression(node.initializer) ? node.initializer.expression : undefined;
        const strings: ts.Node[] = [];
        const collect = (n: ts.Node | undefined) => {
          if (!n) return;
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) strings.push(n);
          else if (ts.isConditionalExpression(n)) { collect(n.whenTrue); collect(n.whenFalse); }
          else if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.BarBarToken || n.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) { collect(n.left); collect(n.right); }
          else if (ts.isParenthesizedExpression(n)) collect(n.expression);
        };
        collect(value);
        const isHtml = /^[a-z]/.test(tag);
        for (const s of strings) {
          if (isHtml && HTML_SHOWN_ATTRS.has(name)) {
            add('A', sf, s, ts.isTemplateExpression(s) ? templateForms(s).pattern : (s as ts.StringLiteral).text, `<${tag} ${name}> is not translated (use a Localized element)`);
          } else if (!isHtml && TRANSLATED_PROPS.has(name)) {
            if (ts.isTemplateExpression(s)) checkTemplate(sf, s, 'prop', tag);
            else checkText(sf, s, (s as ts.StringLiteral).text, 'prop', tag);
          } else if (isHtml === false && /^Localized/.test(tag) && HTML_SHOWN_ATTRS.has(name)) {
            if (ts.isTemplateExpression(s)) checkTemplate(sf, s, 'prop', tag);
            else checkText(sf, s, (s as ts.StringLiteral).text, 'prop', tag);
          }
        }
      } else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
        // {'text'} or {`text ${x}`} or {a ? 'x' : 'y'} written as a child.
        const parent = enclosingTag(node);
        const strings: ts.Node[] = [];
        const collect = (n: ts.Node) => {
          if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n)) strings.push(n);
          else if (ts.isConditionalExpression(n)) { collect(n.whenTrue); collect(n.whenFalse); }
          else if (ts.isBinaryExpression(n) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(n.operatorToken.kind)) { collect(n.left); collect(n.right); }
          else if (ts.isParenthesizedExpression(n)) collect(n.expression);
        };
        collect(node.expression);
        for (const s of strings) {
          if (ts.isTemplateExpression(s)) checkTemplate(sf, s, 'child', parent);
          else checkText(sf, s, (s as ts.StringLiteral).text, 'child', parent);
        }
      } else if (ts.isPropertyAssignment(node) && ['success', 'label', 'title', 'text', 'description', 'gloss', 'hint', 'message'].includes(node.name.getText()) && !ts.isJsxAttribute(node.parent)) {
        // Object data shown through translating components: nav items, toasts, card lists.
        const v = node.initializer;
        if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) checkText(sf, v, v.text, 'prop', null);
        else if (ts.isTemplateExpression(v)) checkTemplate(sf, v, 'prop', null);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // --- Server messages users see (errors in toasts and forms, notifications) ----------------
  const MESSAGE_CALLS: Record<string, number> = { badRequest: 0, conflict: 1, ruleViolation: 1, forbidden: 0, unauthorized: 0, AppError: 2 };
  for (const file of [...walk(path.join(ROOT, 'src/server'), /\.ts$/), ...walk(path.join(ROOT, 'src/shared'), /\.ts$/)]) {
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      const msg = (n: ts.Node | undefined, why = 'message') => {
        if (!n) return;
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) checkText(sf, n, n.text, 'message', null);
        else if (ts.isTemplateExpression(n)) checkTemplate(sf, n, 'message', null);
        else if (ts.isConditionalExpression(n)) { msg(n.whenTrue, why); msg(n.whenFalse, why); }
      };
      if ((ts.isCallExpression(node) || ts.isNewExpression(node)) && node.arguments) {
        const callee = node.expression.getText();
        if (callee in MESSAGE_CALLS) msg(node.arguments[MESSAGE_CALLS[callee]!]);
        // zod: .min(1, 'Choose a day.'), .regex(/x/, 'Check the code.')
        if (ts.isPropertyAccessExpression(node.expression) && ['min', 'max', 'regex', 'refine', 'length', 'email', 'url', 'int', 'positive'].includes(node.expression.name.text)) {
          const last = node.arguments[node.arguments.length - 1];
          if (last && (ts.isStringLiteral(last) || ts.isNoSubstitutionTemplateLiteral(last)) && node.arguments.length >= (node.expression.name.text === 'regex' || node.expression.name.text === 'min' || node.expression.name.text === 'max' || node.expression.name.text === 'length' ? 2 : 1)) msg(last);
        }
        if (callee === 'notify' || callee.endsWith('.notify')) {
          const obj = node.arguments[2];
          if (obj && ts.isObjectLiteralExpression(obj)) for (const p of obj.properties) if (ts.isPropertyAssignment(p) && ['title', 'body'].includes(p.name.getText())) msg(p.initializer);
        }
      }
      if (ts.isNewExpression(node) && node.expression.getText() === 'Error') {
        /* internal errors: not shown */
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  // --- Wider net: sentence-like strings anywhere in pages and components (constants, arrays) ------
  // and user-facing text built on the server (Assistant answers, flood messages, link labels).
  const reported = new Set(findings.map((f) => `${f.file}:${f.line}:${f.text}`));
  const sentence = (s: string) => /^[A-Z“"(][^]*[a-z][^]*\s[^]*$/.test(s.trim()) && !/^(SELECT|INSERT|UPDATE|DELETE|WITH|CREATE|ALTER)\b/.test(s) && !/[{};=<>]|\b(className|text-|bg-|px-)/.test(s);
  const IGNORE_CALLS = new Set(['log.info', 'log.warn', 'log.error', 'log.debug', 'console.log', 'console.error', 'Error', 'describe', 'it', 'expect', 'audit', 'require', 'import']);
  for (const file of [...walk(path.join(ROOT, 'src/app'), /\.tsx?$/), ...walk(path.join(ROOT, 'src/components'), /\.tsx?$/), ...walk(path.join(ROOT, 'src/server/modules/assistant'), /\.ts$/), path.join(ROOT, 'src/server/modules/banjir/agent.ts')]) {
    const isServer = file.includes(`${path.sep}server${path.sep}`);
    const sf = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) || ts.isTypeNode(node)) return;
      if (ts.isCallExpression(node) && IGNORE_CALLS.has(node.expression.getText())) return;
      if (ts.isPropertyAssignment(node) && ['summary', 'description', 'note', 'tag', 'className', 'parameters'].includes(node.name.getText()) && isServer) return;
      // The model's own instructions are not shown to residents.
      if (isServer && ts.isFunctionDeclaration(node) && node.name?.text === 'systemPrompt') return;
      if (isServer && file.endsWith('knowledge.ts') && ts.isPropertyAssignment(node) && node.name.getText() !== 'short') return;
      if (isServer && file.endsWith('tools.ts')) return; // tool data for the model, and the pass summary (a template, checked below)
      const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : ts.isTemplateExpression(node) ? templateForms(node).pattern : null;
      if (text && sentence(text.replace(/\{\d+\}/g, 'x'))) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        const rel = path.relative(ROOT, file).replace(/\\/g, '/');
        const sample = ts.isTemplateExpression(node) ? templateForms(node).sample : text;
        if (!reported.has(`${rel}:${line}:${text.replace(/\s+/g, ' ').trim()}`) && !translated(sample)) {
          findings.push({ kind: 'B', file: rel, line, text: text.replace(/\s+/g, ' ').trim(), why: 'sentence in code (wider net)' });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }


  // SVG path data is not text.
  return findings.filter((f) => !/^M[\d{]/.test(f.text));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = auditTranslations().filter((f) => !ALLOWED.has(f.text));
  const byFile = new Map<string, Finding[]>();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  for (const [file, list] of byFile) {
    console.log(file);
    for (const f of list) console.log(`  ${f.line} [${f.kind}] ${JSON.stringify(f.text.slice(0, 110))}  (${f.why})`);
  }
  console.log(findings.length ? `\n${findings.length} text(s) need a Malay entry or a Text wrapper.` : 'Every interface text has a Malay entry.');
  process.exitCode = findings.length ? 1 : 0;
}
