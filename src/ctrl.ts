import { Request, Response } from 'express';
import { db } from './firebaseConfig';

export const registerUser = async (req: Request, res: Response) => {
    const { name, user, password } = req.body;

    try {
        const newItem = { name, user, password };
        const userExists = await db.collection('users').where('user', '==', user).get();

        if (!userExists.empty) {
            res.status(200).json({ msg: 'Usuário já existe', success: false });
            return;
        }

        const docRef = await db.collection('users').add(newItem);
        res.status(200).json({ user: { id: docRef.id, ...newItem }, success: true });
    } catch (error) {
        console.error('Erro ao registrar usuário:', error);
        res.status(500).json({ error: 'Erro ao registrar usuário' });
    }
};

export const loginUser = async (req: Request, res: Response) => {
    const { user, password } = req.body;

    try {
        const userSnapshot = await db.collection('users').where('user', '==', user).get();

        if (userSnapshot.empty) {
            res.status(200).json({ msg: 'Usuário não encontrado', success: false });
            return
        }

        const userDoc = userSnapshot.docs[0];
        const storedPassword = userDoc.data().password;

        if (storedPassword === password) {
            res.status(200).json({
                user: { ...userDoc.data(), id: userDoc.id },
                success: true
            });
            return
        }

        res.status(200).json({ msg: 'Senha incorreta', success: false });
    } catch (error) {
        console.error('Erro ao realizar login:', error);
        res.status(500).json({ error: 'Erro ao realizar login' });
    }
};

export const getMaterias = async (req: Request, res: Response) => {
    const { id_user } = req.body;

    try {
        const snapshot = await db.collection('materias').where('id_user', '==', id_user).get();
        const items = await Promise.all(snapshot.docs.map(async (doc) => {
            const subcollectionSnapshot = await db.collection('materias').doc(doc.id).collection('faltas').get();
            const faltas = subcollectionSnapshot.docs.map(subDoc => ({
                id: subDoc.id,
                ...subDoc.data()
            }));

            return { id: doc.id, ...doc.data(), faltas };
        }));

        res.json(items);
    } catch (error) {
        console.error('Erro ao buscar matérias:', error);
        res.status(500).json({ error: 'Erro ao buscar matérias' });
    }
};

export const addMateria = async (req: Request, res: Response) => {
    const { id_user, nome, semana, faltas } = req.body;

    try {
        const newMateria = { id_user, nome, semana };

        const docRef = await db.collection('materias').add(newMateria);
        let faltasArray = []

        for (let i = 1; i <= faltas; i++) {
            const docRefFalta = await db.collection('materias').doc(docRef.id).collection('faltas').add({
                active: false,
                indice: i
            });

            faltasArray.push({
                id: docRefFalta.id,
                active: false,
                indice: i
            });
        }

        let response = {
            id_materia: docRef.id,
            success: true,
            msg: "Materia adicionada com sucesso!",
        }

        res.status(200).json(response);

    } catch (error) {
        console.error('Erro ao adicionar matéria:', error);
        res.status(500).json({ error: 'Erro ao adicionar matéria' });
    }
}

export const editMateria = async (req: Request, res: Response) => {
    const { id_materia, nome, faltas, semana, faltas_active } = req.body;

    try {
        const materiaRef = db.collection('materias').doc(id_materia);
        await materiaRef.update({
            nome,
            semana,
        });

        await deleteSubcollection(materiaRef, 'faltas');

        let faltasArray = []

        for (let i = 1; i <= faltas; i++) {

            let activeFalta = i <= faltas_active ? true : false

            const docRefFalta = await db.collection('materias').doc(id_materia).collection('faltas').add({
                active: activeFalta,
                indice: i
            });

            faltasArray.push({
                id: docRefFalta.id,
                active: activeFalta,
                indice: i
            });
        }


        res.status(200).json({ msg: 'Matéria atualizada com sucesso', success: true });
    } catch (error) {
        console.error('Erro ao editar matéria:', error);
        res.status(500).json({ error: 'Erro ao editar matéria' });
    }
};

export const deleteMateria = async (req: Request, res: Response) => {
    const { id_materia } = req.body;

    try {
        await db.collection('materias').doc(id_materia).delete();
        await deleteSubcollection(db.collection('materias').doc(id_materia), 'faltas');

        res.status(200).json({ msg: 'Matéria excluída com sucesso', success: true });
    } catch (error) {
        console.error('Erro ao excluir matéria:', error);
        res.status(500).json({ error: 'Erro ao excluir matéria' });
    }
}

export const activeFalta = async (req: Request, res: Response) => {
    const { indice, active, id_materia } = req.body;

    try {
        const querySnapshot = await db
            .collection('materias')
            .doc(id_materia)
            .collection('faltas')
            .where('indice', '==', indice)
            .limit(1)
            .get();

        const docRef = querySnapshot.docs[0].ref;

        await docRef.update({ active });
        res.status(200).json({ msg: 'Falta atualizada com sucesso', success: true });

    } catch (error) {
        console.error('Erro ao atualizar falta:', error);
        res.status(500).json({ error: 'Erro ao atualizar falta' });
    }
}

const deleteSubcollection = async (docRef: any, subcollectionName: any) => {
    const subcollectionRef = docRef.collection(subcollectionName);
    const snapshot = await subcollectionRef.get();

    const batch = db.batch();
    snapshot.forEach((doc: any) => {
        batch.delete(doc.ref);
    });

    await batch.commit();
}

