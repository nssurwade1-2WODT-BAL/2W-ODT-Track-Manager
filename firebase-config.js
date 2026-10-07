/* Firebase Phase 1
   Initializes Firebase/Firestore without changing the existing app architecture.
   The application continues to use localStorage until the Firestore migration phase.
*/
const firebaseConfig = {
  apiKey: "AIzaSyDbdrDxI6BVhBEhuE6osymVHiiiNRO1ajU",
  authDomain: "w-odt-track-manager-cf9c7.firebaseapp.com",
  projectId: "w-odt-track-manager-cf9c7",
  storageBucket: "w-odt-track-manager-cf9c7.firebasestorage.app",
  messagingSenderId: "456616479075",
  appId: "1:456616479075:web:9b661ace5d626fa6576b56"
};

try {
  if (window.firebase) {
    const firebaseApp = firebase.initializeApp(firebaseConfig);
    const firestoreDb = firebase.firestore();

    // Expose these for the next migration phase without coupling app.js to Firebase yet.
    window.ODTFirebase = {
      app: firebaseApp,
      db: firestoreDb,
      connected: true
    };

    console.info("2W ODT Track Manager: Firebase initialized.");
  } else {
    console.warn("2W ODT Track Manager: Firebase SDK was not loaded. Local mode remains active.");
  }
} catch (error) {
  console.error("2W ODT Track Manager: Firebase initialization failed.", error);
  // Do not block the existing localStorage application if Firebase is unavailable.
  window.ODTFirebase = {
    connected: false,
    error: error
  };
}
