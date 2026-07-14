// bootstrap.js - 带代理配置的启动脚本
process.env.https_proxy = 'http://127.0.0.1:6789';
process.env.http_proxy = 'http://127.0.0.1:6789';
process.env.HTTPS_PROXY = 'http://127.0.0.1:6789';
process.env.HTTP_PROXY = 'http://127.0.0.1:6789';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

require('./apps/agentcore/dist/main.js');
