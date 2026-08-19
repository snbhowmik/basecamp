import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Building2, GraduationCap, GitBranch, Trash2, EyeOff, Eye, Pencil } from 'lucide-react';
import {
  listOrgUnits,
  createOrgUnit,
  listAllBatches,
  createBatch,
  renameOrgUnit,
  renameRequestType,
  renameCategory,
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
import { adminDelete, type DeletableTable } from '../../lib/admin';
import ConfirmDestructive from '../ui/ConfirmDestructive';
import type { OrgUnit, OrgUnitType, Batch, RequestType, RequestCategory, Tag } from '../../types';

type Section = 'org' | 'catalog';

// The captain's configuration surface: the org's shape (org units, batches)
// and its request taxonomy (types, categories, routing). All of it is data —
// nothing here requires a deploy to change, which is the whole point of the
// platform being instantiable (PRD §8.2, README V2).
export default function WorkflowPage() {
  const [section, setSection] = useState<Section>('org');

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Workflow</h1>
          <p className="page-subtitle">
            Org units, batches, and the request categories people can file against — all
            configurable, none of it hardcoded.
          </p>
        </div>
      </div>

      <div className="filter-row" style={{ marginBottom: '1.25rem' }}>
        <button className={`btn btn-sm ${section === 'org' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setSection('org')}>
          <Building2 size={14} /> Org units &amp; batches
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
  const [orgUnits, setOrgUnits] = useState<OrgUnit[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [unitName, setUnitName] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [unitType, setUnitType] = useState<OrgUnitType>('faculty');
  const [unitParent, setUnitParent] = useState('');
  const [batchUnit, setBatchUnit] = useState('');
  const [editUnit, setEditUnit] = useState<string | null>(null);
  const [editUnitName, setEditUnitName] = useState('');
  const [pendingDelete, setPendingDelete] =
    useState<{ table: DeletableTable; id: string; name: string } | null>(null);
  const [batchStartYear, setBatchStartYear] = useState('');
  const [batchEndYear, setBatchEndYear] = useState('');
  const [batchPrefix, setBatchPrefix] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    try {
      const [d, b] = await Promise.all([listOrgUnits(), listAllBatches()]);
      setOrgUnits(d);
      setBatches(b);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const addOrgUnit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await createOrgUnit(unitName, unitCode, unitType, unitParent || null);
      setUnitName('');
      setUnitCode('');
      setUnitParent('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create org unit.');
    } finally {
      setBusy(false);
    }
  };

  const addBatch = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      // Name omitted on purpose — create_batch() derives "<start>-<end>".
      await createBatch(
        batchUnit,
        null,
        Number(batchStartYear),
        Number(batchEndYear),
        'FT',
        batchPrefix.trim() || null,
      );
      setBatchStartYear('');
      setBatchEndYear('');
      setBatchPrefix('');
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create batch.');
    } finally {
      setBusy(false);
    }
  };

  const saveUnitName = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await renameOrgUnit(id, editUnitName);
      setEditUnit(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the org unit.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading-spinner" style={{ marginTop: '3rem' }} />;

  return (
    <>
      {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

      {pendingDelete && (
        <ConfirmDestructive
          title="Delete record"
          recordName={pendingDelete.name}
          description={`Removing "${pendingDelete.name}".`}
          onCancel={() => setPendingDelete(null)}
          onConfirmed={async () => {
            await adminDelete(pendingDelete.table, pendingDelete.id);
            setPendingDelete(null);
            await reload();
          }}
        />
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={16} /> Org units
            </h2>
          </div>
          <div className="card-body">
            <form onSubmit={addOrgUnit} className="grid-cols-2" style={{ marginBottom: '1.25rem', alignItems: 'end' }}>
              <div className="form-group">
                <label className="form-label">Name</label>
                <input className="form-input" required value={unitName} onChange={(e) => setUnitName(e.target.value)} placeholder="Computer Science and Engineering" />
              </div>
              <div className="form-group">
                <label className="form-label">Short code</label>
                <input className="form-input" required value={unitCode} onChange={(e) => setUnitCode(e.target.value)} placeholder="cse" />
              </div>
              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-input"
                  value={unitType}
                  onChange={(e) => {
                    setUnitType(e.target.value as OrgUnitType);
                    if (e.target.value === 'faculty') setUnitParent('');
                  }}
                >
                  <option value="faculty">Faculty / school</option>
                  <option value="programme">Programme</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Parent faculty</label>
                <div className="repeatable-row">
                  <select
                    className="form-input"
                    value={unitParent}
                    disabled={unitType !== 'programme'}
                    onChange={(e) => setUnitParent(e.target.value)}
                  >
                    <option value="">{unitType === 'programme' ? 'Top level' : 'Not applicable'}</option>
                    {orgUnits.filter((u) => u.unit_type === 'faculty').map((u) => (
                      <option key={u.id} value={u.id}>{u.name}</option>
                    ))}
                  </select>
                  <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={15} /></button>
                </div>
              </div>
            </form>

            {orgUnits.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <span className="empty-title">No org units yet</span>
                <span>Add one above — students pick from these when they register.</span>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead><tr><th>Org unit</th><th>Type</th><th>Code</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                  <tbody>
                    {orgUnits.map((d) => (
                      <tr key={d.id}>
                        <td>
                          {editUnit === d.id
                            ? <input className="form-input" value={editUnitName} onChange={(e) => setEditUnitName(e.target.value)} />
                            : <span className="cell-strong">{d.name}</span>}
                        </td>
                        <td>{d.unit_type === 'faculty' ? 'Faculty' : 'Programme'}</td>
                        <td className="cell-mono">{d.code}</td>
                        <td style={{ textAlign: 'right' }}>
                          <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'flex-end' }}>
                            {editUnit === d.id ? (
                              <>
                                <button className="btn btn-primary" disabled={busy} onClick={() => saveUnitName(d.id)}>Save</button>
                                <button className="btn btn-secondary" onClick={() => setEditUnit(null)}>Cancel</button>
                              </>
                            ) : (
                              <>
                                <button className="btn btn-secondary" title="Rename"
                                  onClick={() => { setEditUnit(d.id); setEditUnitName(d.name); }}><Pencil size={14} /></button>
                                <button className="btn btn-secondary" title="Delete"
                                  onClick={() => setPendingDelete({ table: 'org_units', id: d.id, name: d.name })}><Trash2 size={14} /></button>
                              </>
                            )}
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

        <div className="card">
          <div className="card-header">
            <h2 className="section-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <GraduationCap size={16} /> Batches
            </h2>
          </div>
          <div className="card-body">
            <form onSubmit={addBatch} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
              <div className="form-group">
                <label className="form-label">Org unit</label>
                <select className="form-input" required value={batchUnit} onChange={(e) => setBatchUnit(e.target.value)}>
                  <option value="">Select...</option>
                  {orgUnits.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div className="grid-cols-2">
                <div className="form-group">
                  <label className="form-label">Start year</label>
                  <input type="number" className="form-input" required value={batchStartYear} onChange={(e) => setBatchStartYear(e.target.value)} placeholder="2024" />
                </div>
                <div className="form-group">
                  <label className="form-label">End year</label>
                  <input type="number" className="form-input" required value={batchEndYear} onChange={(e) => setBatchEndYear(e.target.value)} placeholder="2028" />
                </div>
              </div>
              <div className="form-group">
                <label className="form-label">Reg-no prefix (optional)</label>
                <div className="repeatable-row">
                  <input className="form-input" value={batchPrefix} onChange={(e) => setBatchPrefix(e.target.value)} placeholder="RA2211003" />
                  <button className="btn btn-primary" type="submit" disabled={busy || orgUnits.length === 0}><Plus size={15} /></button>
                </div>
                <span className="form-hint">
                  This batch will be named{' '}
                  <strong>{batchStartYear && batchEndYear ? `${batchStartYear}-${batchEndYear}` : '<start>-<end>'}</strong>.
                </span>
              </div>
            </form>

            {batches.length === 0 ? (
              <div className="empty-state" style={{ padding: '2rem' }}>
                <span className="empty-title">No batches yet</span>
                <span>Add intakes like "2023-2027" per org unit. A reg-no prefix lets self-registration validate the number against the batch.</span>
              </div>
            ) : (
              <div className="table-container">
                <table>
                  <thead><tr><th>Batch</th><th>Org unit</th><th style={{ textAlign: 'right' }}>Actions</th></tr></thead>
                  <tbody>
                    {batches.map((b) => (
                      <tr key={b.id}>
                        <td className="cell-strong">{b.name}</td>
                        <td>{orgUnits.find((d) => d.id === b.org_unit_id)?.name ?? '—'}</td>
                        <td style={{ textAlign: 'right' }}>
                          <button className="btn btn-secondary" title="Delete"
                            onClick={() => setPendingDelete({ table: 'batches', id: b.id, name: b.name })}><Trash2 size={14} /></button>
                        </td>
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
  const [typeMode, setTypeMode] = useState<'approval' | 'log_only'>('approval');
  const [catClass, setCatClass] = useState<'tech' | 'non_tech' | ''>('');
  const [catRetain, setCatRetain] = useState(false);

  const [routingFor, setRoutingFor] = useState<RequestCategory | null>(null);
  const [editType, setEditType] = useState<string | null>(null);
  const [editTypeName, setEditTypeName] = useState('');
  const [editCat, setEditCat] = useState<string | null>(null);
  const [editCatName, setEditCatName] = useState('');
  const [catDelete, setCatDelete] =
    useState<{ table: DeletableTable; id: string; name: string } | null>(null);

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
      await createRequestType(typeCode, typeName, typeMode);
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
        name: catName,
        classification: catClass || null,
        retainAttachments: catRetain,
      });
      setCatName('');
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

  const saveTypeName = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await renameRequestType(id, editTypeName);
      setEditType(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the request type.');
    } finally {
      setBusy(false);
    }
  };

  const saveCatName = async (id: string) => {
    setBusy(true);
    setError('');
    try {
      await renameCategory(id, editCatName);
      setEditCat(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename the category.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="loading-spinner" style={{ marginTop: '3rem' }} />;

  const categoriesOfType = categories.filter((c) => !catType || c.request_type_id === catType);

  return (
    <>
      {error && <div className="alert alert-danger" style={{ marginBottom: '1.25rem' }}>{error}</div>}

      {catDelete && (
        <ConfirmDestructive
          title="Delete record"
          recordName={catDelete.name}
          description={`Removing "${catDelete.name}".`}
          onCancel={() => setCatDelete(null)}
          onConfirmed={async () => {
            await adminDelete(catDelete.table, catDelete.id);
            setCatDelete(null);
            await reload();
          }}
        />
      )}

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
              <input className="form-input" required value={typeCode} onChange={(e) => setTypeCode(e.target.value)} placeholder="od_request" />
            </div>
            <div className="form-group">
              <label className="form-label">Decision mode</label>
              <div className="repeatable-row">
                <select className="form-input" value={typeMode} onChange={(e) => setTypeMode(e.target.value as 'approval' | 'log_only')}>
                  <option value="approval">Approval — needs a real decision</option>
                  <option value="log_only">Log only — reviewed and saved</option>
                </select>
                <button className="btn btn-primary" type="submit" disabled={busy}><Plus size={15} /></button>
              </div>
            </div>
          </form>
          {types.length === 0 ? (
            <span className="form-hint">None yet.</span>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr><th>Type</th><th>Code</th><th>Mode</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.id}>
                      <td>
                        {editType === t.id
                          ? <input className="form-input" value={editTypeName} onChange={(e) => setEditTypeName(e.target.value)} />
                          : <span className="cell-strong">{t.name}</span>}
                      </td>
                      <td className="cell-mono">{t.code}</td>
                      <td>
                        <span className="status-badge status-neutral">
                          {t.decision_mode === 'approval' ? 'Approval' : 'Log only'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          {editType === t.id ? (
                            <>
                              <button className="btn btn-primary btn-sm" disabled={busy}
                                onClick={() => saveTypeName(t.id)}>Save</button>
                              <button className="btn btn-secondary btn-sm"
                                onClick={() => setEditType(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="btn-icon" title="Rename"
                                onClick={() => { setEditType(t.id); setEditTypeName(t.name); }}>
                                <Pencil size={15} />
                              </button>
                              <button className="btn-icon" title="Delete"
                                onClick={() => setCatDelete({ table: 'request_types', id: t.id, name: t.name })}>
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
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
                <label className="form-label">Classification</label>
                <select className="form-input" value={catClass} onChange={(e) => setCatClass(e.target.value as 'tech' | 'non_tech' | '')}>
                  <option value="">Unclassified</option>
                  <option value="tech">Tech</option>
                  <option value="non_tech">Non-tech</option>
                </select>
              </div>
            </div>
            <div className="grid-cols-2">
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
                  <tr><th>Category</th><th>Class</th><th>Parent</th><th>Status</th><th style={{ textAlign: 'right' }}>Actions</th></tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id}>
                      <td>
                        {editCat === c.id ? (
                          <input className="form-input" value={editCatName}
                            onChange={(e) => setEditCatName(e.target.value)} />
                        ) : (
                          <div className="cell-strong">{c.name}</div>
                        )}
                        <div className="cell-mono">{types.find((t) => t.id === c.request_type_id)?.code ?? ''}</div>
                      </td>
                      <td>
                        {c.classification
                          ? <span className="status-badge status-neutral">{c.classification === 'tech' ? 'Tech' : 'Non-tech'}</span>
                          : <span className="detail-value empty">—</span>}
                      </td>
                      <td>{categories.find((p) => p.id === c.parent_id)?.name ?? '—'}</td>
                      <td>
                        <span className={`status-badge ${c.is_active ? 'status-success' : 'status-neutral'}`}>
                          {c.is_active ? 'Active' : 'Hidden'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                          {editCat === c.id ? (
                            <>
                              <button className="btn btn-primary btn-sm" disabled={busy}
                                onClick={() => saveCatName(c.id)}>Save</button>
                              <button className="btn btn-secondary btn-sm"
                                onClick={() => setEditCat(null)}>Cancel</button>
                            </>
                          ) : (
                            <>
                              <button className="btn btn-secondary btn-sm" onClick={() => setRoutingFor(c)}>Routing</button>
                              <button className="btn-icon" title="Rename"
                                onClick={() => { setEditCat(c.id); setEditCatName(c.name); }}>
                                <Pencil size={15} />
                              </button>
                              <button className="btn-icon" title={c.is_active ? 'Hide' : 'Show'} onClick={() => toggleActive(c)}>
                                {c.is_active ? <EyeOff size={15} /> : <Eye size={15} />}
                              </button>
                              <button className="btn-icon" title="Delete"
                                onClick={() => setCatDelete({ table: 'request_categories', id: c.id, name: c.name })}>
                                <Trash2 size={15} />
                              </button>
                            </>
                          )}
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
                  {tags.filter((t) => !t.code.startsWith('org:')).map((t) => (
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
