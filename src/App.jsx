import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { createCertificateId, downloadPdf, generateCertificatePdf } from './certificate';

const formatDate = (iso) => {
  const [year, month, day] = iso.split('-');
  return `${month}/${day}/${year}`;
};

function Layout({ children, user }) {
  return <><header><div><strong>Certificate Portal</strong><span>Learning & Development</span></div><nav><Link to="/verify">Verify</Link>{user && <><Link to="/admin/generate">Generate</Link><Link to="/admin/dashboard">Dashboard</Link><button className="linkButton" onClick={() => signOut(auth)}>Sign out</button></>}</nav></header><main>{children}</main></>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const submit = async (e) => { e.preventDefault(); setError(''); try { await signInWithEmailAndPassword(auth, email.trim(), password); navigate('/admin/generate'); } catch { setError('Unable to sign in. Check the approved admin account and password.'); } };
  return <section className="card narrow"><h1>Administrator sign in</h1><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required /></label><label>Password<input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required /></label>{error && <p className="error">{error}</p>}<button>Sign in</button></form></section>;
}

function Generate({ user }) {
  const [form, setForm] = useState({ recipientName: '', courseName: '', completionDate: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const change = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setMessage('');
    try {
      const recipientName = form.recipientName.trim();
      const courseName = form.courseName.trim();
      const displayDate = formatDate(form.completionDate);
      let certificateId;
      for (let i = 0; i < 5; i += 1) { const candidate = createCertificateId(form.completionDate.slice(0,4)); if (!(await getDoc(doc(db, 'certificates', candidate))).exists()) { certificateId = candidate; break; } }
      if (!certificateId) throw new Error('Could not create a unique ID.');
      const record = { certificateId, recipientName, courseName, completionDate: form.completionDate, displayDate, status: 'valid', templateVersion: 'v1', issuedAt: serverTimestamp(), issuedBy: user.email, revokedAt: null, revocationReason: null };
      await setDoc(doc(db, 'certificates', certificateId), record);
      const verificationUrl = `${window.location.origin}/verify/${certificateId}`;
      const bytes = await generateCertificatePdf({ ...record, verificationUrl });
      downloadPdf(bytes, `${certificateId}-${recipientName.replace(/[^a-z0-9]+/gi,'-')}.pdf`);
      setMessage(`Certificate generated and saved: ${certificateId}`);
      setForm({ recipientName: '', courseName: '', completionDate: '' });
    } catch (error) { setMessage(error.message || 'Certificate generation failed.'); } finally { setBusy(false); }
  };
  return <section className="card"><h1>Generate certificate</h1><p>Each generated certificate is saved before the PDF is downloaded.</p><form onSubmit={submit}><label>Recipient name<input maxLength="100" value={form.recipientName} onChange={change('recipientName')} required /></label><label>Course name<textarea maxLength="180" value={form.courseName} onChange={change('courseName')} required /></label><label>Completion date<input type="date" value={form.completionDate} onChange={change('completionDate')} required /></label><button disabled={busy}>{busy ? 'Generating…' : 'Generate certificate'}</button>{message && <p className="notice">{message}</p>}</form></section>;
}

function Verify() {
  const params = useParams(); const [id, setId] = useState(params.certificateId || ''); const [record, setRecord] = useState(null); const [state, setState] = useState('idle');
  const verify = async (value = id) => { const normalized = value.trim().toUpperCase(); if (!normalized) return; setState('loading'); const snapshot = await getDoc(doc(db, 'certificates', normalized)); if (!snapshot.exists()) { setRecord(null); setState('missing'); return; } setRecord(snapshot.data()); setState('found'); };
  useEffect(() => { if (params.certificateId) verify(params.certificateId); }, [params.certificateId]);
  return <section className="card"><h1>Verify a certificate</h1><div className="inline"><input placeholder="NH-LD-2026-XXXXXXXXXX" value={id} onChange={(e)=>setId(e.target.value)} /><button onClick={()=>verify()}>Verify</button></div>{state==='loading'&&<p>Checking…</p>}{state==='missing'&&<div className="result invalid"><h2>No valid certificate found</h2><p>Check the ID and try again.</p></div>}{state==='found'&&<div className={`result ${record.status==='valid'?'valid':'invalid'}`}><h2>{record.status==='valid'?'Valid certificate':'Certificate revoked'}</h2><dl><dt>Name</dt><dd>{record.recipientName}</dd><dt>Course</dt><dd>{record.courseName}</dd><dt>Completion date</dt><dd>{record.displayDate}</dd><dt>Certificate ID</dt><dd>{record.certificateId}</dd><dt>Status</dt><dd>{record.status}</dd></dl></div>}</section>;
}

function Dashboard() {
  const [rows, setRows] = useState([]); const [search, setSearch] = useState('');
  const load = async () => { const snapshots = await getDocs(query(collection(db,'certificates'), orderBy('completionDate','desc'))); setRows(snapshots.docs.map((d)=>d.data())); };
  useEffect(()=>{load();},[]);
  const filtered = useMemo(()=>rows.filter((r)=>`${r.recipientName} ${r.courseName} ${r.certificateId}`.toLowerCase().includes(search.toLowerCase())),[rows,search]);
  const revoke = async (row) => { const reason = window.prompt('Reason for revocation:'); if (!reason) return; await updateDoc(doc(db,'certificates',row.certificateId),{status:'revoked',revocationReason:reason,revokedAt:serverTimestamp()}); load(); };
  const restore = async (row) => { await updateDoc(doc(db,'certificates',row.certificateId),{status:'valid',revocationReason:null,revokedAt:null}); load(); };
  return <section className="card wide"><div className="headingRow"><div><h1>Certificate dashboard</h1><p>{rows.length} certificate records</p></div><input placeholder="Search name, course or ID" value={search} onChange={(e)=>setSearch(e.target.value)} /></div><div className="tableWrap"><table><thead><tr><th>Name</th><th>Course</th><th>Date</th><th>ID</th><th>Status</th><th>Action</th></tr></thead><tbody>{filtered.map((row)=><tr key={row.certificateId}><td>{row.recipientName}</td><td>{row.courseName}</td><td>{row.displayDate}</td><td><Link to={`/verify/${row.certificateId}`}>{row.certificateId}</Link></td><td>{row.status}</td><td>{row.status==='valid'?<button className="danger" onClick={()=>revoke(row)}>Revoke</button>:<button onClick={()=>restore(row)}>Restore</button>}</td></tr>)}</tbody></table></div></section>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(()=>onAuthStateChanged(auth,setUser),[]);
  if (user===undefined) return <main><p>Loading…</p></main>;
  return <Layout user={user}><Routes><Route path="/" element={<Verify/>}/><Route path="/verify" element={<Verify/>}/><Route path="/verify/:certificateId" element={<Verify/>}/><Route path="/admin/login" element={<Login/>}/><Route path="/admin/generate" element={user?<Generate user={user}/>:<Login/>}/><Route path="/admin/dashboard" element={user?<Dashboard/>:<Login/>}/></Routes></Layout>;
}
