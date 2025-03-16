import { Router } from 'express';
import { registerUser, loginUser, getMaterias } from './ctrl';

const router = Router();

router.post('/register', registerUser);
router.post('/login', loginUser);
router.post('/getMaterias', getMaterias);

export default router;
