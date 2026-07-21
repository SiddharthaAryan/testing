import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyByKkSoWgaJNRQhkDPwlql5uRFv4eXWSW4',
  authDomain: 'nh-certificate-verification.firebaseapp.com',
  projectId: 'nh-certificate-verification',
  storageBucket: 'nh-certificate-verification.firebasestorage.app',
  messagingSenderId: '130997482561',
  appId: '1:130997482561:web:f2fa80fc408021e3e982c0',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
