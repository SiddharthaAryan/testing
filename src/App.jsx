import { useEffect, useMemo, useState } from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth, db } from './firebase';
import { downloadPdf, generateCertificatePdf } from './certificate';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const createInternalRecordKey = (year) => {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (n) => alphabet[n % alphabet.length]).join('');
  return `NH-LD-${year}-${code}`;
};

const formatDate = (iso) => {
  const [year, month, day] = iso.split('-');
  return `${month}/${day}/${year}`;
};

const safeFilename = (value) => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');

async function makePdf(record) {
  const displayDate = record.completionDate ? formatDate(record.completionDate) : record.displayDate;
  const bytes = await generateCertificatePdf({ ...record, displayDate });
  const filename = `${safeFilename(record.recipientName)}-${safeFilename(record.courseName)}.pdf`;
  return { bytes, filename };
}

async function makeAndDownloadPdf(record, openedWindow = null) {
  const { bytes, filename } = await makePdf(record);
  downloadPdf(bytes, filename, openedWindow);
}

function Layout({ children, user }) {
  return <>
    <header className="siteHeader">
      <Link className="brand" to="/">
        <span className="brandMark">NH</span>
        <span><strong>Narayana Health</strong><small>Learning & Development</small></span>
      </Link>
      <nav>
        <Link to="/">Generate Certificate</Link>
        {user ? <>
          <Link to="/admin/dashboard">Dashboard</Link>
          <button className="linkButton" onClick={() => signOut(auth)}>Sign out</button>
        </> : <Link to="/admin/login">Admin sign in</Link>}
      </nav>
    </header>
    <main>{children}</main>
    <footer>MMI Narayana Health · Learning & Development certificate portal</footer>
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
      navigate('/');
    } catch {
      setError('Unable to sign in. Check the approved administrator account and password.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="card narrow authCard">
    <div className="eyebrow">Authorised access</div>
    <h1>Administrator sign in</h1>
    <p className="muted">Sign in to issue, download and manage official certificates.</p>
    <form onSubmit={submit}>
      <label>Email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
      <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
      {error && <p className="errorBox">{error}</p>}
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
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
    const openedWindow = window.open('', '_blank');
    if (openedWindow) {
      openedWindow.document.write('<title>Preparing certificate…</title><p style="font-family:Arial;padding:32px">Preparing your certificate…</p>');
    }

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

      let internalRecordKey;
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const candidate = createInternalRecordKey(form.completionDate.slice(0, 4));
        if (!(await getDoc(doc(db, 'certificates', candidate))).exists()) {
          internalRecordKey = candidate;
          break;
        }
      }
      if (!internalRecordKey) throw new Error('Could not create the issue record. Please try again.');

      const record = {
        certificateId: internalRecordKey,
        recipientName,
        courseName,
        completionDate: form.completionDate,
        displayDate: formatDate(form.completionDate),
        status: 'valid',
        templateVersion: 'v1',
        issuedAt: serverTimestamp(),
        issuedBy: user.email,
        revokedAt: null,
        revokedBy: null,
        revocationReason: null,
      };

      await setDoc(doc(db, 'certificates', internalRecordKey), record);
      await makeAndDownloadPdf(record, openedWindow);
      setMessageType('success');
      setMessage('Certificate downloaded and opened successfully.');
      setForm({ recipientName: '', courseName: '', completionDate: '' });
    } catch (error) {
      if (openedWindow && !openedWindow.closed) openedWindow.close();
      setMessageType('errorBox');
      setMessage(error.message || 'Certificate generation failed.');
    } finally {
      setBusy(false);
    }
  };

  return <div className="pageGrid">
    <section className="heroPanel">
      <div className="eyebrow light">Official certificate portal</div>
      <h1>Create polished certificates in seconds.</h1>
      <p>Generate consistent learning and development certificates using the approved Narayana Health template.</p>
      <div className="heroPoints">
        <span>✓ Instant PDF download</span>
        <span>✓ Approved certificate layout</span>
        <span>✓ Automatic issue record</span>
      </div>
    </section>

    <section className="card generatorCard">
      <div className="eyebrow">Certificate generation</div>
      <h2>Generate a certificate</h2>
      <p className="muted">Enter the final approved details. The PDF will download and open automatically.</p>
      <form onSubmit={submit}>
        <label>Recipient name<input maxLength="100" value={form.recipientName} onChange={change('recipientName')} placeholder="Full name as it should appear" required /></label>
        <label>Course name<textarea maxLength="180" value={form.courseName} onChange={change('courseName')} placeholder="Course or training programme" required /></label>
        <label>Completion date<input type="date" value={form.completionDate} onChange={change('completionDate')} required /></label>
        <button className="primaryAction" disabled={busy}>{busy ? 'Generating certificate…' : 'Generate & download certificate'}</button>
        {message && <p className={messageType}>{message}</p>}
      </form>
    </section>
  </div>;
}

function exportCsv(rows) {
  const columns = ['recipientName', 'courseName', 'completionDate', 'status', 'issuedBy', 'revocationReason'];
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
      setRows(snapshots.docs.map((item) => ({ ...item.data(), docId: item.id })));
    } catch {
      setLoadError('Could not load certificate records. Check Firebase configuration and permissions.');
    }
  };
  useEffect(() => { load(); }, []);

  const courses = useMemo(() => [...new Set(rows.map((row) => row.courseName))].sort(), [rows]);
  const filtered = useMemo(() => rows.filter((row) => {
    const matchesText = `${row.recipientName} ${row.courseName}`.toLowerCase().includes(search.toLowerCase());
    return matchesText && (status === 'all' || row.status === status) && (course === 'all' || row.courseName === course);
  }), [rows, search, status, course]);

  const revoke = async (row) => {
    const reason = window.prompt(`Enter the reason for revoking ${row.recipientName}'s certificate:`);
    if (!reason?.trim()) return;
    setBusyId(row.docId);
    await updateDoc(doc(db, 'certificates', row.docId), {
      status: 'revoked', revocationReason: reason.trim(), revokedAt: serverTimestamp(), revokedBy: user.email,
    });
    await load();
    setBusyId('');
  };

  const restore = async (row) => {
    if (!window.confirm(`Restore ${row.recipientName}'s certificate to valid status?`)) return;
    setBusyId(row.docId);
    await updateDoc(doc(db, 'certificates', row.docId), {
      status: 'valid', revocationReason: null, revokedAt: null, revokedBy: null,
    });
    await load();
    setBusyId('');
  };

  const regenerate = async (row) => {
    const openedWindow = window.open('', '_blank');
    setBusyId(row.docId);
    try { await makeAndDownloadPdf(row, openedWindow); } finally { setBusyId(''); }
  };

  const validCount = rows.filter((row) => row.status === 'valid').length;
  const revokedCount = rows.length - validCount;

  return <section className="card wide">
    <div className="headingRow">
      <div><div className="eyebrow">Administration</div><h1>Certificate dashboard</h1><p className="muted">Issue records and certificate downloads</p></div>
      <button className="secondary" onClick={() => exportCsv(filtered)} disabled={!filtered.length}>Export CSV</button>
    </div>
    <div className="stats">
      <div><strong>{rows.length}</strong><span>Total issued</span></div>
      <div><strong>{validCount}</strong><span>Valid</span></div>
      <div><strong>{revokedCount}</strong><span>Revoked</span></div>
      <div><strong>{courses.length}</strong><span>Courses</span></div>
    </div>
    <div className="filters">
      <input placeholder="Search name or course" value={search} onChange={(e) => setSearch(e.target.value)} />
      <select value={course} onChange={(e) => setCourse(e.target.value)}><option value="all">All courses</option>{courses.map((item) => <option key={item}>{item}</option>)}</select>
      <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option><option value="valid">Valid</option><option value="revoked">Revoked</option></select>
    </div>
    {loadError && <p className="errorBox">{loadError}</p>}
    <p className="muted">Showing {filtered.length} of {rows.length} records</p>
    <div className="tableWrap">
      <table>
        <thead><tr><th>Name</th><th>Course</th><th>Date</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {filtered.map((row) => <tr key={row.docId}>
            <td>{row.recipientName}</td><td>{row.courseName}</td><td>{row.completionDate ? formatDate(row.completionDate) : row.displayDate}</td>
            <td><span className={`badge ${row.status}`}>{row.status}</span></td>
            <td><div className="actions">
              <button className="small secondary" disabled={busyId === row.docId} onClick={() => regenerate(row)}>PDF</button>
              {row.status === 'valid'
                ? <button className="small danger" disabled={busyId === row.docId} onClick={() => revoke(row)}>Revoke</button>
                : <button className="small" disabled={busyId === row.docId} onClick={() => restore(row)}>Restore</button>}
            </div></td>
          </tr>)}
          {!filtered.length && <tr><td colSpan="5" className="empty">No matching certificate records.</td></tr>}
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
    <Route path="/" element={user ? <Generate user={user} /> : <Login />} />
    <Route path="/admin/login" element={user ? <Generate user={user} /> : <Login />} />
    <Route path="/admin/generate" element={user ? <Generate user={user} /> : <Login />} />
    <Route path="/admin/dashboard" element={user ? <Dashboard user={user} /> : <Login />} />
  </Routes></Layout>;
}
