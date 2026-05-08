/**
 * Inlined `@codemirror/lang-markdown`. The upstream package was vendored so we
 * could patch `insertNewlineContinueMarkup` to never insert an extra blank
 * line when continuing a non-tight list.
 *
 * HTML tag completion and the HTML sublanguage parser were dropped — this app
 * doesn't use them. Paste-URL-as-link is kept since it's small and useful.
 */
import { Prec, Extension } from '@codemirror/state';
import { KeyBinding, keymap, EditorView } from '@codemirror/view';
import { Language, LanguageSupport, LanguageDescription, syntaxTree } from '@codemirror/language';
import { MarkdownExtension, MarkdownParser, parseCode } from '@lezer/markdown';
import { commonmarkLanguage, markdownLanguage, mkLang, getCodeParser, headerIndent } from './markdown';
import { insertNewlineContinueMarkup, deleteMarkupBackward, toggleBold } from './commands';

export {
  commonmarkLanguage,
  markdownLanguage,
  insertNewlineContinueMarkup,
  deleteMarkupBackward,
  toggleBold,
};

/// A small keymap with Markdown-specific bindings. Binds Enter to
/// `insertNewlineContinueMarkup` and Backspace to `deleteMarkupBackward`.
export const markdownKeymap: readonly KeyBinding[] = [
  { key: 'Enter', run: insertNewlineContinueMarkup },
  { key: 'Backspace', run: deleteMarkupBackward },
];

/// Markdown language support.
export function markdown(
  config: {
    /// When given, this language will be used by default to parse code blocks.
    defaultCodeLanguage?: Language | LanguageSupport;
    /// A source of language support for highlighting fenced code blocks.
    codeLanguages?:
      | readonly LanguageDescription[]
      | ((info: string) => Language | LanguageDescription | null);
    /// Set this to false to disable installation of the Markdown keymap.
    addKeymap?: boolean;
    /// Markdown parser extensions.
    extensions?: MarkdownExtension;
    /// The base language to use. Defaults to `commonmarkLanguage`.
    base?: Language;
  } = {},
) {
  const {
    codeLanguages,
    defaultCodeLanguage,
    addKeymap = true,
    base: { parser } = commonmarkLanguage,
  } = config;
  if (!(parser instanceof MarkdownParser))
    throw new RangeError('Base parser provided to `markdown` should be a Markdown parser');

  const extensions = config.extensions ? [config.extensions] : [];
  const support: Extension[] = [headerIndent];
  let defaultCode: Language | undefined;

  support.push(pasteURLAsLink);

  if (defaultCodeLanguage instanceof LanguageSupport) {
    support.push(defaultCodeLanguage.support);
    defaultCode = defaultCodeLanguage.language;
  } else if (defaultCodeLanguage) {
    defaultCode = defaultCodeLanguage;
  }

  const codeParser =
    codeLanguages || defaultCode ? getCodeParser(codeLanguages, defaultCode) : undefined;
  extensions.push(parseCode({ codeParser }));

  if (addKeymap) support.push(Prec.high(keymap.of(markdownKeymap)));

  const lang = mkLang(parser.configure(extensions));
  return new LanguageSupport(lang, support);
}

const nonPlainText = /code|horizontalrule|html|link|comment|processing|escape|entity|image|mark|url/i;

/// An extension that intercepts pastes when the pasted content looks like a
/// URL and the selection is non-empty and selects regular text, making the
/// selection a link with the pasted URL as target.
export const pasteURLAsLink = EditorView.domEventHandlers({
  paste: (event, view) => {
    const { main } = view.state.selection;
    if (main.empty) return false;
    let link = event.clipboardData?.getData('text/plain');
    if (!link || !/^(https?:\/\/|mailto:|xmpp:|www\.)/.test(link)) return false;
    if (/^www\./.test(link)) link = 'https://' + link;
    if (!markdownLanguage.isActiveAt(view.state, main.from, 1)) return false;
    const tree = syntaxTree(view.state);
    let crossesNode = false;
    tree.iterate({
      from: main.from,
      to: main.to,
      enter: (node) => {
        if (node.from > main.from || nonPlainText.test(node.name)) crossesNode = true;
      },
      leave: (node) => {
        if (node.to < main.to) crossesNode = true;
      },
    });
    if (crossesNode) return false;
    view.dispatch({
      changes: [
        { from: main.from, insert: '[' },
        { from: main.to, insert: `](${link})` },
      ],
      userEvent: 'input.paste',
      scrollIntoView: true,
    });
    return true;
  },
});
