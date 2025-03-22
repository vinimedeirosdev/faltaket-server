import { Router } from 'express';
import {
    registerUser, loginUser, getMaterias, addMateria, editMateria, deleteMateria, activeFalta, editUser
} from './ctrl';

const router = Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/getMaterias', getMaterias);
router.post('/addMateria', addMateria);
router.post('/editMateria', editMateria);
router.post('/deleteMateria', deleteMateria);
router.post('/activeFalta', activeFalta);
router.post('/editUser', editUser);

export default router;
