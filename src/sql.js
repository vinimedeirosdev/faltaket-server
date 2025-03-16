"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Sql = /** @class */ (function () {
    function Sql(conexao) {
        this.conexao = conexao;
    }
    Sql.prototype.getUserByUser = function (user) {
        var sql = "SELECT id FROM users WHERE user = ?";
        return this.conexao.prepare(sql).get(user);
    };
    Sql.prototype.registerUser = function (param) {
        var sql = "INSERT INTO users (name, user, password) VALUES (?, ?, ?)";
        return this.conexao.prepare(sql).run(param.name, param.user, param.password);
    };
    Sql.prototype.loginUser = function (user, password) {
        var sql = "SELECT id, name, user, password FROM users WHERE user = ? AND password = ?";
        return this.conexao.prepare(sql).get(user, password);
    };
    return Sql;
}());
exports.default = Sql;
