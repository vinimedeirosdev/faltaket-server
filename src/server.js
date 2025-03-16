"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var express_1 = __importDefault(require("express"));
var better_sqlite3_1 = __importDefault(require("better-sqlite3"));
var cors_1 = __importDefault(require("cors"));
var ctrl_1 = __importDefault(require("./ctrl")); // Supondo que você tenha a classe Ctrl no arquivo ctrl.ts
var app = (0, express_1.default)();
var db = new better_sqlite3_1.default('database.sqlite');
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// Cria a tabela (caso não exista)
db.prepare("\n    CREATE TABLE IF NOT EXISTS users (\n        id INTEGER PRIMARY KEY AUTOINCREMENT,\n        name TEXT NOT NULL,\n        user TEXT UNIQUE NOT NULL,\n        password TEXT NOT NULL,\n        created_at DATETIME DEFAULT CURRENT_TIMESTAMP\n    )\n").run();
// Classe Router para organizar as rotas
var Router = /** @class */ (function () {
    function Router(conexao) {
        this.conexao = conexao;
        this.ctrl = new ctrl_1.default(this.conexao); // Supondo que a classe Ctrl usa o banco
    }
    // Definindo os métodos de roteamento
    Router.prototype.routes = function (app) {
        var _this = this;
        // Rota para listar usuários
        app.get('/users', function (req, res) {
            var users = _this.conexao.prepare('SELECT * FROM users').all();
            res.json(users);
        });
        // Rota para adicionar um usuário
        app.post('/register', function (req, res) { return __awaiter(_this, void 0, void 0, function () {
            var _a, name, user, password, result;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _a = req.body, name = _a.name, user = _a.user, password = _a.password;
                        return [4 /*yield*/, this.ctrl.register({ name: name, user: user, password: password })];
                    case 1:
                        result = _b.sent();
                        res.json(result);
                        return [2 /*return*/];
                }
            });
        }); });
        app.post('/login', function (req, res) { return __awaiter(_this, void 0, void 0, function () {
            var _a, user, password, result;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        _a = req.body, user = _a.user, password = _a.password;
                        return [4 /*yield*/, this.ctrl.login(user, password)];
                    case 1:
                        result = _b.sent();
                        res.json(result);
                        return [2 /*return*/];
                }
            });
        }); });
    };
    return Router;
}());
var router = new Router(db);
router.routes(app); // Chama os métodos de rota da classe Router
// Porta do servidor
var PORT = 5000;
app.listen(PORT, function () {
    console.log("\u2705 Backend rodando em http://localhost:".concat(PORT));
});
