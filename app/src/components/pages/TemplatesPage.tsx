import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Bold, Italic, Heading, List, Save, Plus, Eye } from 'lucide-react';
import { errorMessage } from '../../lib/errors';
import { listCategories } from '../../lib/org';
import { listLevels } from '../../lib/levels';
import {
  listBindingKeys, listTemplates, saveTemplate, sanitizeDocumentHtml,
  type BindingKey, type DocumentTemplate,
} from '../../lib/documents';
import type { RequestCategory, PriorityLevel } from '../../types';

// The captain's document template editor — PRD.md §14.3.
//
// Annexure 4.4 and the NOC are NOT shipped with the product. They are written
// here, per category, like every other configuration surface: "No fixture
// data" means a new document type is an afternoon's typing, not a deploy.
//
// Saving always publishes a NEW version rather than editing in place, because
// a document already issued must regenerate identically — see the append-only
// note in schema-v2/0017_document_templates.sql. The version list is shown so
// that is visible rather than surprising.
export default function TemplatesPage() {
  const [categories, setCategories] = useState<RequestCategory[]>([]);
  const [levels, setLevels] = useState<PriorityLevel[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [keys, setKeys] = useState<BindingKey[]>([]);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);

  const [docType, setDocType] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewing, setPreviewing] = useState(false);

  const editorRef = useRef<HTMLDivElement | null>(null);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    Promise.all([listCategories(), listLevels()])
      .then(([c, l]) => { setCategories(c); setLevels(l); })
      .catch((err) => setError(errorMessage(err, 'Could not load categories.')));
  }, []);

  const reload = useCallback(async (id: string) => {
    if (!id) { setKeys([]); setTemplates([]); return; }
    try {
      const [k, t] = await Promise.all([listBindingKeys(id), listTemplates(id)]);
      setKeys(k);
      setTemplates(t);
    } catch (err) {
      setError(errorMessage(err, 'Could not load templates.'));
    }
  }, []);

  useEffect(() => { reload(categoryId); }, [categoryId, reload]);

  // contenteditable loses the caret the moment a toolbar button takes focus,
  // so the selection is captured on the way out and restored before inserting.
  const rememberCaret = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const insertAtCaret = (text: string) => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (!range) { el.append(text); return; }
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRange.current = range.cloneRange();
  };

  // execCommand is deprecated but is still the only thing every browser
  // implements for contenteditable formatting; the alternative is shipping a
  // rich text engine for four buttons.
  const format = (command: string, value?: string) => {
    editorRef.current?.focus();
    if (savedRange.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(savedRange.current);
    }
    document.execCommand(command, false, value);
  };

  const handleSave = async () => {
    setError(''); setMsg('');
    const html = sanitizeDocumentHtml(editorRef.current?.innerHTML ?? '');
    if (!categoryId) { setError('Choose a category first.'); return; }
    if (!docType.trim()) { setError('Give the document a type, e.g. annexure_4_4.'); return; }
    if (!editorRef.current?.textContent?.trim()) { setError('The template is empty.'); return; }

    setBusy(true);
    try {
      await saveTemplate(categoryId, docType.trim(), name.trim() || docType.trim(), html);
      await reload(categoryId);
      setMsg('Published. Documents generated from now on use this version; ones already issued keep theirs.');
    } catch (err) {
      setError(errorMessage(err, 'Could not save the template.'));
    } finally {
      setBusy(false);
    }
  };

  const loadVersion = (t: DocumentTemplate) => {
    setDocType(t.doc_type);
    setName(t.name);
    if (editorRef.current) editorRef.current.innerHTML = sanitizeDocumentHtml(t.body_html);
    setMsg(`Loaded ${t.doc_type} v${t.version}. Saving publishes a new version.`);
  };

  const builtIns = keys.filter((k) => k.source === 'built-in');
  const fields = keys.filter((k) => k.source === 'field');

  // Signature slots store the level's id, not its name — renaming a level
  // must not silently unmatch every template that references it. The id is
  // unreadable though, so the preview shows the name back.
  const readableSlots = (html: string) =>
    levels.reduce(
      (acc, l) => acc.replaceAll(`{{signature:${l.id}}}`, `⟨${l.name}'s signature⟩`),
      html,
    );

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title"><FileText size={22} /> Document templates</h1>
        <p className="page-subtitle">
          Letters generated from a request — an Annexure, an NOC. Written here, per category, with the
          request's own fields dropped in.
        </p>
      </div>

      {error && <div className="alert alert-danger">{error}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}

      <div className="card">
        <div className="card-body">
          <div className="tpl-fields">
            <div className="form-group">
              <label className="form-label">Category</label>
              <select className="form-input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">Choose a category…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Document type</label>
              <input
                className="form-input"
                placeholder="annexure_4_4"
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Display name</label>
              <input
                className="form-input"
                placeholder="Annexure 4.4"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      {categoryId && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-header">
            <h3 className="card-title">Template</h3>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setPreviewing((p) => !p)}>
              <Eye size={15} /> {previewing ? 'Edit' : 'Preview'}
            </button>
          </div>
          <div className="card-body">
            <div className="tpl-toolbar">
              <button type="button" className="btn btn-secondary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => format('bold')}><Bold size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => format('italic')}><Italic size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => format('formatBlock', 'h2')}><Heading size={15} /></button>
              <button type="button" className="btn btn-secondary btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => format('insertUnorderedList')}><List size={15} /></button>

              <span className="tpl-toolbar-sep" />

              <select
                className="form-input tpl-select"
                value=""
                onMouseDown={rememberCaret}
                onChange={(e) => { if (e.target.value) insertAtCaret(e.target.value); e.target.value = ''; }}
              >
                <option value="">Insert field…</option>
                {builtIns.length > 0 && (
                  <optgroup label="From the request">
                    {builtIns.map((k) => <option key={k.key} value={`{{${k.key}}}`}>{k.label}</option>)}
                  </optgroup>
                )}
                {fields.length > 0 && (
                  <optgroup label="This category's fields">
                    {fields.map((k) => <option key={k.key} value={`{{${k.key}}}`}>{k.label}</option>)}
                  </optgroup>
                )}
              </select>

              <select
                className="form-input tpl-select"
                value=""
                onMouseDown={rememberCaret}
                onChange={(e) => { if (e.target.value) insertAtCaret(e.target.value); e.target.value = ''; }}
              >
                <option value="">Insert signature…</option>
                {levels.map((l) => (
                  <option key={l.id} value={`{{signature:${l.id}}}`}>{l.name}'s signature</option>
                ))}
              </select>
            </div>

            {previewing ? (
              <div
                className="tpl-surface"
                dangerouslySetInnerHTML={{ __html: readableSlots(sanitizeDocumentHtml(editorRef.current?.innerHTML ?? '')) }}
              />
            ) : (
              <div
                ref={editorRef}
                className="tpl-surface"
                contentEditable
                suppressContentEditableWarning
                onKeyUp={rememberCaret}
                onMouseUp={rememberCaret}
                onBlur={rememberCaret}
              />
            )}

            <p className="text-muted" style={{ fontSize: '0.85rem' }}>
              A field that has no value on a request prints as a dash, so a gap is visible rather than silent.
              A signature slot with nobody signed prints “Not yet signed”.
            </p>

            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={busy}>
              <Save size={16} /> {busy ? 'Publishing…' : 'Publish version'}
            </button>
          </div>
        </div>
      )}

      {templates.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <div className="card-header"><h3 className="card-title">Published versions</h3></div>
          <div className="card-body table-container" style={{ padding: 0 }}>
            <table className="table">
              <thead>
                <tr><th>Type</th><th>Name</th><th>Version</th><th>Published</th><th /></tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id}>
                    <td><code>{t.doc_type}</code></td>
                    <td>{t.name}</td>
                    <td>v{t.version}</td>
                    <td>{new Date(t.created_at).toLocaleDateString()}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadVersion(t)}>
                        <Plus size={14} /> New version from this
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
