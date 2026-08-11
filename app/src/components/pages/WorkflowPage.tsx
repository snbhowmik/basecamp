import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Building2, GraduationCap, GitBranch, Trash2, EyeOff, Eye } from 'lucide-react';
import {
  listDepartments,
  createDepartment,
  listAllBatches,
  createBatch,
  listRequestTypes,
  createRequestType,
  listCategories,
  createCategory,
  setCategoryActive,
  listFirstHopOptions,
  createFirstHopOption,
  deleteFirstHopOption,
  type FirstHopOption,
} from '../../lib/org';
import { listTags } from '../../lib/invites';
import type { Department, Class, RequestType, RequestCategory, Tag } from '../../types';

type Section = 'org' | 'catalog';

// The captain's configuration surface: the org's shape (departments,
// batches) and its request taxonomy (types, categories, routing). All of it
// is data — nothing here requires a deploy to change, which is the whole
// point of the platform being instantiable (PRD §8.2, README V2).
export default function WorkflowPage() {
  const [section, setSection] = useState<Section>('org');

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workflow</h1>
          <p className="page-subtitle">
            Departments, batches, and the request categories people can file against — all
            configurable, none of it hardcoded.
          </p>
        </div>
      </div>

      <div className="filter-row" style={{ marginBottom: '1.25rem' }}>
        <button className={`btn btn-sm ${section === 'org' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('org')}>
          <Building2 size={14} /> Departments &amp; batches
        </button>
        <button className={`btn btn-sm ${section === 'catalog' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('catalog')}>
          <GitBranch size={14} /> Request catalog
        </button>
      </div>

      {section === 'org' ? <OrgSection /> : <CatalogSection />}
    </>
  );
}

// ------------------------------------------------------------------

function OrgSection() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [batches, setBatches] = useState<Class[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [batchDept, setBatchDept] = useState('');
  const [batchName, setBatchName] = useState('');
  const [batchYear, setBatchYear] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const [d, b] = await Promise.all([listDepartments(), listAllBatches()]);
      setDepartments(d);
      setBatches(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const addDepartment = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createDepartment(deptName, deptCode);
      setDeptName('');
      setDeptCode('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create department.');
    } finally {
      setBusy(false);
    }
  };

  const addBatch = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createBatch(batchDept, batchName, Number(batchYear));
      setBatchName('');
      setBatchYear('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create batch.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading-spinner" style={{ marginTop: '3rem' }} />;

  return (
    <>
      {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={16} /> Departments
            </h2>
          </div>
          <div className="card-body">
            <form onSubmit={addDepartment} className="grid-cols-2" style={{ marginBottom: '1.25rem', alignItems: 'end' }}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" required value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Computer Science and Engineering" />
              </div>
              <div className="form-group">
                <label className="form-label">Short code</label>
                <div className="repeatable-row">
                  <input className="form-input" required value={deptCode} onChange={(e) => setDeptCode(e.target.value)} placeholder="cse" />
                  <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={15} /></button>
                </div>
              </div>
            </form>

            {departments.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <span className="empty-title">No departments yet</span>
                <span>Add one above — students pick from these when they register.</span>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead><tr><th>Department</th><th>Code</th></tr></thead>
                  <tbody>
                    {departments.map((d) => (
                      <tr key={d.id}>
                        <td className="cell-strong">{d.name}</td>
                        <td className="cell-mono">{d.code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <GraduationCap size={16} /> Batches
            </h2>
          </div>
          <div className="card-body">
            <form onSubmit={addBatch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Department</label>
                <select className="form-input" required value={batchDept} onChange={(e) => setBatchDept(e.target.value)}>
                  <option value="">Select...</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="grid-cols-2">
                <div className="form-group">
                  <label className="form-label">Batch</label>
                  <input className="form-input" required value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="2023-2027" />
                </div>
                <div className="form-group">
                  <label className="form-label">Start year</label>
                  <div className="repeatable-row">
                    <input type="number" className="form-input" required value={batchYear} onChange={(e) => setBatchYear(e.target.value)} placeholder="2023" />
                    <button className="btn btn-primary" type="submit" disabled={busy || departments.length === 0}><Plus size={15} /></button>
                  </div>
                </div>
              </div>
            </form>

            {batches.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <span className="empty-title">No batches yet</span>
                <span>Add intakes like "2023-2027" per department.</span>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead><tr><th>Batch</th><th>Department</th></tr></thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td className="cell-strong">{b.name}</td>
                        <td>{departments.find((d) => d.id === b.department_id)?.name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------

function CatalogSection() {
  const [types, setTypes] = useState<RequestType[]>([]);
  const [categories, setCategories] = useState<RequestCategory[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [typeName, setTypeName] = useState('');
  const [typeCode, setTypeCode] = useState('');

  const [catType, setCatType] = useState('');
  const [catParent, setCatParent] = useState('');
  const [catName, setCatName] = useState('');
  const [catCode, setCatCode] = useState('');
  const [catMode, setCatMode] = useState<'approval' | 'log_only'>('approval');
  const [catRetain, setCatRetain] = useState(false);

  const [routingFor, setRoutingFor] = useState<RequestCategory | null>(null);

  const reload = async () => {
    try {
      const [t, c, tg] = await Promise.all([listRequestTypes(), listCategories(), listTags()]);
      setTypes(t);
      setCategories(c);
      setTags(tg);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const addType = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createRequestType(typeCode, typeName);
      setTypeCode('');
      setTypeName('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create request type.');
    } finally {
      setBusy(false);
    }
  };

  const addCategory = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createCategory({
        requestTypeId: catType,
        parentId: catParent || null,
        code: catCode,
        name: catName,
        decisionMode: catMode,
        retainAttachments: catRetain,
      });
      setCatName('');
      setCatCode('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create category.');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (c: RequestCategory) => {
    try {
      await setCategoryActive(c.id, !c.is_active);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update category.');
    }
  };

  if (loading) return <div className="loading-spinner" style={{ marginTop: '3rem' }} />;

  const categoriesOfType = categories.filter((c) => !catType || c.request_type_id === catType);

  return (
    <>
      {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div className="card-header"><h2 className="section-title">Request types</h2></div>
        <div className="card-body">
          <form onSubmit={addType} className="grid-cols-2" style={{ marginBottom: '1rem', alignItems: 'end' }}>
            <div className="form-group">
              <label className="form-label">Name</label>
              <input className="form-input" required value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="On-Duty Request" />
            </div>
            <div className="form-group">
              <label className="form-label">Code</label>
              <div className="repeatable-row">
                <input className="form-input" required value={typeCode} onChange={(e) => setTypeCode(e.target.value)} placeholder="od_request" />
                <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={15} /></button>
              </div>
            </div>
          </form>
          <div className="chip-list">
            {types.length === 0 && <span className="form-hint">None yet.</span>}
            {types.map((t) => <span key={t.id} className="chip">{t.name}</span>)}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h2 className="section-title">Categories</h2></div>
        <div className="card-body">
          <form onSubmit={addCategory} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
            <div className="grid-cols-2">
              <div className="form-group">
                <label className="form-label">Request type</label>
                <select className="form-input" required value={catType} onChange={(e) => { setCatType(e.target.value); setCatParent(''); }}>
                  <option value="">Select...</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Parent category (optional)</label>
                <select className="form-input" value={catParent} onChange={(e) => setCatParent(e.target.value)} disabled={!catType}>
                  <option value="">Top level</option>
                  {categoriesOfType.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid-cols-2">
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" required value={catName} onChange={(e) => setCatName(e.target.value)} placeholder="Hackathon" />
              </div>
              <div className="form-group">
                <label className="form-label">Code</label>
                <input className="form-input" required value={catCode} onChange={(e) => setCatCode(e.target.value)} placeholder="hackathon" />
              </div>
            </div>
            <div className="grid-cols-2">
              <div className="form-group">
                <label className="form-label">Decision mode</label>
                <select className="form-input" value={catMode} onChange={(e) => setCatMode(e.target.value as 'approval' | 'log_only')}>
                  <option value="approval">Approval — needs a real decision</option>
                  <option value="log_only">Log only — reviewed and saved</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Attachments after close</label>
                <select className="form-input" value={catRetain ? 'keep' : 'purge'} onChange={(e) => setCatRetain(e.target.value === 'keep')}>
                  <option value="purge">Purge after a grace period</option>
                  <option value="keep">Keep permanently (certificates)</option>
                </select>
              </div>
            </div>
            <div>
              <button className="btn btn-primary" type="submit" disabled={busy || types.length === 0}>
                <Plus size={15} /> Add category
              </button>
              {types.length === 0 && <span className="form-hint" style={{ marginLeft: '0.75rem' }}>Create a request type first.</span>}
            </div>
          </form>

          {categories.length === 0 ? (
            <div className="empty-state" style={{ padding: '2rem' }}>
              <span className="empty-title">No categories yet</span>
              <span>Categories are what people actually file requests against.</span>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Category</th><th>Mode</th><th>Parent</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="cell-strong">{c.name}</div>
                        <div className="cell-mono">{c.code}</div>
                      </td>
                      <td>
                        <span className={`status-badge ${c.decision_mode === 'approval' ? 'status-progress' : 'status-neutral'}`}>
                          {c.decision_mode === 'approval' ? 'Approval' : 'Log only'}
                        </span>
                      </td>
                      <td>{categories.find((p) => p.id === c.parent_id)?.name ?? '—'}</td>
                      <td>
                        <span className={`status-badge ${c.is_active ? 'status-success' : 'status-neutral'}`}>
                          {c.is_active ? 'Active' : 'Hidden'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setRoutingFor(c)}>Routing</button>
                          <button className="btn-icon" title={c.is_active ? 'Hide' : 'Show'} onClick={() => toggleActive(c)}>
                            {c.is_active ? <EyeOff size={15} /> : <Eye size={15} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {routingFor && (
        <RoutingEditor category={routingFor} tags={tags} onClose={() => setRoutingFor(null)} />
      )}
    </>
  );
}

// ------------------------------------------------------------------

function RoutingEditor({ category, tags, onClose }: { category: RequestCategory; tags: Tag[]; onClose: () => void }) {
  const [options, setOptions] = useState<FirstHopOption[]>([]);
  const [label, setLabel] = useState('');
  const [tagCode, setTagCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const reload = () => listFirstHopOptions(category.id).then(setOptions).catch(() => setOptions([]));
  useEffect(() => { reload(); }, [category.id]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createFirstHopOption(category.id, label, tagCode);
      setLabel('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add option.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await deleteFirstHopOption(id).catch(() => {});
    await reload();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Routing — {category.name}</h2>
          <button className="close-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="form-hint">
            Who should this category's requests go to first? Each option resolves to real people by
            tag when someone files a request — so "Your Mentor" finds the mentor for that student's
            own batch, not a fixed person.
          </p>
          {error && <div className="alert alert-danger">{error}</div>}

          <form onSubmit={add} className="grid-cols-2" style={{ alignItems: 'end' }}>
            <div className="form-group">
              <label className="form-label">Label shown to the requester</label>
              <input className="form-input" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Your Mentor" />
            </div>
            <div className="form-group">
              <label className="form-label">Resolves to tag</label>
              <div className="repeatable-row">
                <select className="form-input" required value={tagCode} onChange={(e) => setTagCode(e.target.value)}>
                  <option value="">Select a tag...</option>
                  {tags.filter((t) => !t.code.startsWith('dept:') && !t.code.startsWith('class:')).map((t) => (
                    <option key={t.id} value={t.code}>{t.label} ({t.code})</option>
                  ))}
                </select>
                <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={15} /></button>
              </div>
            </div>
          </form>

          {options.length === 0 ? (
            <span className="form-hint">
              No options configured — requests in this category will be submitted unassigned.
            </span>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>Label</th><th>Tag</th><th /></tr></thead>
                <tbody>
                  {options.map((o) => (
                    <tr key={o.id}>
                      <td className="cell-strong">{o.label}</td>
                      <td className="cell-mono">{o.resolve_tag}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button className="btn-icon danger" onClick={() => remove(o.id)}><Trash2 size={15} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
