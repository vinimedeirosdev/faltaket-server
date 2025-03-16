import * as dotenv from 'dotenv';
import * as admin from 'firebase-admin';

// Carregar variáveis de ambiente
dotenv.config();

const firebaseConfig = {
    projectId: process.env.FIREBASE_PROJECT_ID,
    credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`,
};

// Inicializar o Firebase
admin.initializeApp(firebaseConfig);

// Exportar a instância do Firestore
const db = admin.firestore();
export { db };
