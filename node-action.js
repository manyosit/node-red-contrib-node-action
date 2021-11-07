/*
* Based on the original node red httpin node
*/

module.exports = function(RED) {
    "use strict";
    const bodyParser = require("body-parser");

    const corsSetup = false;

    let corsHandler = function(req,res,next) { next(); }

    if (RED.settings.httpNodeCors) {
        corsHandler = cors(RED.settings.httpNodeCors);
        RED.httpNode.options("*",corsHandler);
    }

    function createResponseWrapper(node, res) {
        const wrapper = {
            _res: res
        };
        const toWrap = [
            "append",
            "attachment",
            "cookie",
            "clearCookie",
            "download",
            "end",
            "format",
            "get",
            "json",
            "jsonp",
            "links",
            "location",
            "redirect",
            "render",
            "send",
            "sendfile",
            "sendFile",
            "sendStatus",
            "set",
            "status",
            "type",
            "vary"
        ];
        toWrap.forEach(function(f) {
            wrapper[f] = function() {
                node.warn(RED._("actonin.errors.deprecated-call",{method:"msg.res."+f}));
                const result = res[f].apply(res,arguments);
                if (result === res) {
                    return wrapper;
                } else {
                    return result;
                }
            }
        });
        return wrapper;
    }

    function ActionIn(n) {
        RED.nodes.createNode(this, n);
        if (RED.settings.httpNodeRoot !== false) {

            if (!n.id) {
                this.warn(RED._("actionin.errors.missing-path"));
                return;
            }
            this.id = n.id;
            if (this.id[0] !== '/') {
                this.id = '/'+this.id;
            }

            this.swaggerDoc = n.swaggerDoc;

            var node = this;

            this.errorHandler = function(err,req,res,next) {
                node.warn(err);
                res.sendStatus(500);
            };

            this.callback = function(req,res) {
                const msgid = RED.util.generateId();
                res._msgid = msgid;
                let nodeMessage = {_msgid:msgid, req:req, res:createResponseWrapper(node, res), payload: {}}
                if (req.body) {
                    nodeMessage = {...nodeMessage, ...req.body}
                }
                node.send(nodeMessage);
            };

            let httpMiddleware = function(req,res,next) { next(); }

            if (RED.settings.httpNodeMiddleware) {
                if (typeof RED.settings.httpNodeMiddleware === "function" || Array.isArray(RED.settings.httpNodeMiddleware)) {
                    httpMiddleware = RED.settings.httpNodeMiddleware;
                }
            }

            const maxApiRequestSize = RED.settings.apiMaxLength || '5mb';
            const jsonParser = bodyParser.json({limit:maxApiRequestSize});
            const urlencParser = bodyParser.urlencoded({limit:maxApiRequestSize,extended:true});

            let metricsHandler = function(req,res,next) { next(); }
            if (this.metric()) {
                metricsHandler = function(req, res, next) {
                    var startAt = process.hrtime();
                    onHeaders(res, function() {
                        if (res._msgid) {
                            var diff = process.hrtime(startAt);
                            var ms = diff[0] * 1e3 + diff[1] * 1e-6;
                            var metricResponseTime = ms.toFixed(3);
                            var metricContentLength = res.getHeader("content-length");
                            //assuming that _id has been set for res._metrics in HttpOut node!
                            node.metric("response.time.millis", {_msgid:res._msgid} , metricResponseTime);
                            node.metric("response.content-length.bytes", {_msgid:res._msgid} , metricContentLength);
                        }
                    });
                    next();
                };
            }

            RED.httpNode.post('/smile' + this.id, httpMiddleware, metricsHandler, this.callback, this.errorHandler);

            this.on("close",function() {
                var node = this;
                RED.httpNode._router.stack.forEach(function(route,i,routes) {
                    if (route.route && route.route.path === node.url && route.route.methods[node.method]) {
                        routes.splice(i,1);
                    }
                });
            });
        } else {
            this.warn(RED._("actionin.errors.not-created"));
        }
    }
    RED.nodes.registerType("action in",ActionIn);


    function ActionOut(n) {
        RED.nodes.createNode(this, n);
        const node = this;
        this.statusCode = n.statusCode;
        this.on("input",function(msg,_send,done) {
            if (msg.res) {
                let statusCode = node.statusCode || msg.statusCode || 200;
                if (msg.context && msg.context.data && typeof msg.context.data == "object" && !Buffer.isBuffer(msg.context.data)) {
                    const responseData = {data:msg.context.data}
                    if (msg.payload && typeof msg.payload == "object" && !Buffer.isBuffer(msg.payload)) {
                        responseData.payload = msg.payload
                    }
                    msg.res._res.status(statusCode).json(responseData);
                } else {
                    node.warn(RED._("actionin.errors.no-data"));
                }
            } else {
                node.warn(RED._("actionin.errors.no-response"));
            }
            done();
        });
    }
    RED.nodes.registerType("action response",ActionOut);
}