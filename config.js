var mssql = require('mssql');

var dbConfig = {
    user: 'user32',
    password: 'hello',
    server: 'DESKTOP-N69P0E7',
    database: 'Music_Collections',
    port: 1433,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

module.exports = {
    dbConfig
};
