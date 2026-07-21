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

const safeFilename = (value) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

async function makeAndDownloadPdf(record) {
  const verificationUrl = `${window.location.origin}/verify/${record.certificateId}`;
  const bytes = await generateCertificatePdf({ ...record, verificationUrl });
  downloadPdf(bytes, `${record.certificateId}-${safeFilename(record.recipientName)}.pdf`);
}

function Layout({ children, user }) {
  return <>
    <header>
      <div><strong>Certificate Portal</strong><span>Learning & Development</span></div>
      <nav>
        <Link to="/verify">Verify</Link>
        {user ? <>
          <Link to="/admin/generate">Generate</Link>
          <Link to="/admin/dashboard">Dashboard</Link>
          <button className="linkButton" onClick={() => signOut(auth)}>Sign out</button>
        </> : <Link to="/admin/login">Admin</Link>}
      </nav>
    </header>
    <main>{children}</main>
  </>;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate('/admin/generate');
    } catch {
      setError('Unable to sign in. Check the approved administrator account and password.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="card narrow">
    <h1>Administrator sign in</h1>
    <p className="muted">Only authorised administrators can issue or change certificate records.</p>
    <form onSubmit={submit}>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p className="error">{error}</p>}
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  </section>;
}

function Generate({ user }) {
  const [form, setForm] = useState({ recipientName: '', courseName: '', completionDate: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('notice');
  const change = (key) => (event) => setForm({ ...form, [key]: event.target.value });

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const recipientName = form.recipientName.trim().replace(/\s+/g, ' ');
      const courseName = form.courseName.trim().replace(/\s+/g, ' ');
      if (recipientName.length < 2) throw new Error('Enter a valid recipient name.');
      if (courseName.length < 2) throw new Error('Enter a valid course name.');
      if (!form.completionDate) throw new Error('Select a completion date.');

      const selectedDate = new Date(`${form.completionDate}T00:00:00`);
      const tomorrow = new Date();
      tomorrow.setHours(23, 59, 59, 999);
      if (selectedDate > tomorrow) throw new Error('The completion date cannot be in the future.');

      const displayDate = formatDate(form.completionDate);
      let certificateId;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = createCertificateId(form.completionDate.slice(0, 4));
        if (!(await getDoc(doc(db, 'certificates', candidate))).exists()) {
          certificateId = candidate;
          break;
        }
      }
      if (!certificateId) throw new Error('Could not create a unique certificate ID. Try again.');

      const record = {
        certificateId,
        recipientName,
        courseName,
        completionDate: form.completionDate,
        displayDate,
        status: 'valid',
        templateVersion: 'v1',
        issuedAt: serverTimestamp(),
        issuedBy: user.email,
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
      };

      await setDoc(doc(db, 'certificates', certificateId), record);
      await makeAndDownloadPdf(record);
      setMessageType('success');
      setMessage(`Certificate generated, recorded and downloaded. ID: ${certificateId}`);
      setForm({ recipientName: '', courseName: '', completionDate: '' });
    } catch (error) {
      setMessageType('errorBox');
      setMessage(error.message || 'Certificate generation failed.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="card">
    <h1>Generate certificate</h1>
    <p className="muted">The verification record is saved before the PDF is downloaded.</p>
    <form onSubmit={submit}>
      <label>Recipient name<input maxLength="100" value={form.recipientName} onChange={change('recipientName')} placeholder="Full name as it should appear" required /></label>
      <label>Course name<textarea maxLength="180" value={form.courseName} onChange={change('courseName')} placeholder="Course or training programme" required /></label>
      <label>Completion date<input type="date" value={form.completionDate} onChange={change('completionDate')} required /></label>
      <button disabled={busy}>{busy ? 'Generating certificate…' : 'Generate certificate'}</button>
      {message && <p className={messageType}>{message}</p>}
    </form>
  </section>;
}

function Verify() {
  const params = useParams();
  const [id, setId] = useState(params.certificateId || '');
  const [record, setRecord] = useState(null);
  const [state, setState] = useState('idle');

  const verify = async (value = id) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) return;
    setId(normalized);
    setState('loading');
    try {
      const snapshot = await getDoc(doc(db, 'certificates', normalized));
      if (!snapshot.exists()) {
        setRecord(null);
        setState('missing');
        return;
      }
      setRecord(snapshot.data());
      setState('found');
    } catch {
      setRecord(null);
      setState('error');
    }
  };

  useEffect(() => { if (params.certificateId) verify(params.certificateId); }, [params.certificateId]);

  return <section className="card">
    <h1>Verify a certificate</h1>
    <p className="muted">Enter the complete certificate ID printed at the bottom of the PDF.</p>
    <div className="inline">
      <input placeholder="NH-LD-2026-XXXXXXXXXX" value={id} onChange={(e) => setId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && verify()} />
      <button onClick={() => verify()}>Verify</button>
    </div>
    {state === 'loading' && <p>Checking certificate record…</p>}
    {state === 'error' && <div className="result invalid"><h2>Verification unavailable</h2><p>Please try again shortly.</p></div>}
    {state === 'missing' && <div className="result invalid"><h2>No certificate found</h2><p>The ID does not match an issued certificate.</p></div>}
    {state === 'found' && <div className={`result ${record.status === 'valid' ? 'valid' : 'invalid'}`}>
      <h2>{record.status === 'valid' ? 'Valid certificate' : 'Certificate revoked'}</h2>
      <dl>
        <dt>Name</dt><dd>{record.recipientName}</dd>
        <dt>Course</dt><dd>{record.courseName}</dd>
        <dt>Completion date</dt><dd>{record.displayDate}</dd>
        <dt>Certificate ID</dt><dd>{record.certificateId}</dd>
        <dt>Status</dt><dd className="capitalize">{record.status}</dd>
        {record.status === 'revoked' && record.revocationReason && <><dt>Reason</dt><dd>{record.revocationReason}</dd></>}
      </dl>
    </div>}
  </section>;
}

function exportCsv(rows) {
  const columns = ['certificateId', 'recipientName', 'courseName', 'completionDate', 'status', 'issuedBy', 'revocationReason'];
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `certificate-records-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Dashboard({ user }) {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [course, setCourse] = useState('all');
  const [busyId, setBusyId] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = async () => {
    setLoadError('');
    try {
      const snapshots = await getDocs(query(collection(db, 'certificates'), orderBy('completionDate', 'desc')));
      setRows(snapshots.docs.map((item) => item.data()));
    } catch {
      setLoadError('Could not load certificate records. Check Firebase configuration and permissions.');
    }
  };
  useEffect(() => { load(); }, []);

  const courses = useMemo(() => [...new Set(rows.map((row) => row.courseName))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const matchesText = `${row.recipientName} ${row.courseName} ${row.certificateId}`.toLowerCase().includes(search.toLowerCase());
    return matchesText && (status === 'all' || row.status === status) && (course === 'all' || row.courseName === course);
  }), [rows, search, status, course]);

  const revoke = async (row) => {
    const reason = window.prompt('Enter the reason for revocation:');
    if (!reason?.trim()) return;
    setBusyId(row.certificateId);
    await updateDoc(doc(db, 'certificates', row.certificateId), {
      status: 'revoked', revocationReason: reason.trim(), revokedAt: serverTimestamp(), revokedBy: user.email,
    });
    await load();
    setBusyId('');
  };

  const restore = async (row) => {
    if (!window.confirm(`Restore ${row.certificateId} to valid status?`)) return;
    setBusyId(row.certificateId);
    await updateDoc(doc(db, 'certificates', row.certificateId), {
      status: 'valid', revocationReason: null, revokedAt: null, revokedBy: null,
    });
    await load();
    setBusyId('');
  };

  const regenerate = async (row) => {
    setBusyId(row.certificateId);
    try { await makeAndDownloadPdf(row); } finally { setBusyId(''); }
  };

  const validCount = rows.filter((row) => row.status === 'valid').length;
  const revokedCount = rows.length - validCount;

  return <section className="card wide">
    <div className="headingRow">
      <div><h1>Certificate dashboard</h1><p className="muted">Issue records, verification status and downloads</p></div>
      <button className="secondary" onClick={() => exportCsv(filtered)} disabled={!filtered.length}>Export CSV</button>
    </div>

    <div className="stats">
      <div><strong>{rows.length}</strong><span>Total issued</span></div>
      <div><strong>{validCount}</strong><span>Valid</span></div>
      <div><strong>{revokedCount}</strong><span>Revoked</span></div>
      <div><strong>{courses.length}</strong><span>Courses</span></div>
    </div>

    <div className="filters">
      <input placeholder="Search name, course or certificate ID" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select value={course} onChange={(e) => setCourse(e.target.value)}><option value="all">All courses</option>{courses.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="valid">Valid</option><option value="revoked">Revoked</option></select>
    </div>

    {loadError && <p className="errorBox">{loadError}</p>}
    <p className="muted">Showing {filtered.length} of {rows.length} records</p>
    <div className="tableWrap">
      <table>
        <thead><tr><th>Name</th><th>Course</th><th>Date</th><th>Certificate ID</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {filtered.map((row) => <tr key={row.certificateId}>
            <td>{row.recipientName}</td><td>{row.courseName}</td><td>{row.displayDate}</td>
            <td><Link to={`/verify/${row.certificateId}`}>{row.certificateId}</Link></td>
            <td><span className={`badge ${row.status}`}>{row.status}</span></td>
            <td><div className="actions">
              <button className="small secondary" disabled={busyId === row.certificateId} onClick={() => regenerate(row)}>PDF</button>
              {row.status === 'valid'
                ? <button className="small danger" disabled={busyId === row.certificateId} onClick={() => revoke(row)}>Revoke</button>
                : <button className="small" disabled={busyId === row.certificateId} onClick={() => restore(row)}>Restore</button>}
            </div></td>
          </tr>)}
          {!filtered.length && <tr><td colSpan="6" className="empty">No matching certificate records.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

export default function App() {
  const [user, setUser] = useState(undefined);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  if (user === undefined) return <main><p>Loading portal…</p></main>;

  return <Layout user={user}><Routes>
    <Route path="/" element={<Verify />} />
    <Route path="/verify" element={<Verify />} />
    <Route path="/verify/:certificateId" element={<Verify />} />
    <Route path="/admin/login" element={user ? <Generate user={user} /> : <Login />} />
    <Route path="/admin/generate" element={user ? <Generate user={user} /> : <Login />} />
    <Route path="/admin/dashboard" element={user ? <Dashboard user={user} /> : <Login />} />
  </Routes></Layout>;
}
