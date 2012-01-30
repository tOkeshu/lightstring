'use strict';

/**
  Copyright (c) 2011, Sonny Piers <sonny at fastmail dot net>

  Permission to use, copy, modify, and/or distribute this software for any
  purpose with or without fee is hereby granted, provided that the above
  copyright notice and this permission notice appear in all copies.

  THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
  WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
  MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
  ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
  WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
  ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
  OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
*/


/**
 * @namespace No code from lightstring should be callable outside this namespace/scope.
 */
var Lightstring = {
  /**
   * @namespace Holds XMPP namespaces.
   */
  NS: {
    stream: 'http://etherx.jabber.org/streams',
    jabberClient: 'jabber:client'
  },
  /**
   * @namespace Holds XMPP stanza builders.
   */
  stanza: {
    stream: {
      open: function(aService) {
        //FIXME no ending "/" - node-xmpp-bosh bug
        return "<stream:stream to='" + aService + "'" +
                             " xmlns='" + Lightstring.NS.jabberClient + "'" +
                             " xmlns:stream='" + Lightstring.NS.stream + "'" +
                             " version='1.0'/>";
      },
      close: function() {
        return "</stream:stream>";
      }
    }
  },
  /**
   * @private
   */
  parser: new DOMParser(),
  /**
   * @private
   */
  serializer: new XMLSerializer(),
  /**
   * @function Transforms a XML string to a DOM object.
   * @param {String} aString XML string.
   * @return {Object} Domified XML.
   */
  XML2DOM: function(aString) {
    var DOM = null;
    try {
      DOM = this.parser.parseFromString(aString, 'text/xml').documentElement;
    }
    catch (e) {
      alert(e);
    }
    finally {
      return DOM;
    };
  },
  /**
   * @function Transforms a DOM object to a XML string.
   * @param {Object} aString DOM object.
   * @return {String} Stringified DOM.
   */
  DOM2XML: function(aElement) {
    var XML = null;
    try {
      XML = this.serializer.serializeToString(aElement);
    }
    catch (e) {
      alert(e);
    }
    finally {
      return XML;
    };
  },
  /**
   * @function Get an unique identifier.
   * @param {String} [aString] Prefix to put before the identifier.
   * @return {String} Identifier.
   */
  newId: (function() {
    var id = 1024;
    return function(prefix) {
      if (typeof prefix === 'string')
        return prefix + id++;
      return '' + id++;
    };
  })()
};

/**
 * @constructor Creates a new Lightstring connection
 * @param {String} [aService] The Websocket service URL.
 * @memberOf Lightstring
 */
Lightstring.Connection = function(aService) {
  if (aService)
    this.service = aService;
  this.handlers = {};
  this.on('stream:features', function(stanza, that) {
    var nodes = stanza.DOM.querySelectorAll('mechanism');
    //SASL/Auth features
    if (nodes.length > 0) {
      that.emit('mechanisms', stanza);
      var mechanisms = {};
      for (var i = 0; i < nodes.length; i++)
        mechanisms[nodes[i].textContent] = true;


      //FIXME support SCRAM-SHA1 && allow specify method preferences
      if ('DIGEST-MD5' in mechanisms)
        that.send(
          "<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl'" +
               " mechanism='DIGEST-MD5'/>"
        );
      else if ('PLAIN' in mechanisms) {
        var token = btoa(
          that.jid +
          '\u0000' +
          that.jid.node +
          '\u0000' +
          that.password
        );
        that.send(
          "<auth xmlns='urn:ietf:params:xml:ns:xmpp-sasl'" +
               " mechanism='PLAIN'>" + token + "</auth>"
        );
      }
    }
    //XMPP features
    else {
      that.emit('features', stanza);
      //Bind http://xmpp.org/rfcs/rfc3920.html#bind
      var bind =
        "<iq type='set' xmlns='jabber:client'>" +
          "<bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'>" +
            (that.jid.resource? "<resource>" + that.jid.resource + "</resource>": "") +
          "</bind>" +
        "</iq>";

      that.send(
        bind,
        function(stanza) {
          //Session http://xmpp.org/rfcs/rfc3921.html#session
          that.jid = new Lightstring.JID(stanza.DOM.textContent);
          that.send(
            "<iq type='set' xmlns='jabber:client'>" +
              "<session xmlns='urn:ietf:params:xml:ns:xmpp-session'/>" +
            "</iq>",
            function() {
              that.emit('connected');
            }
          );
        }
      );
    }
  });
  this.on('success', function(stanza, that) {
    that.send(
      "<stream:stream to='" + that.jid.domain + "'" +
                    " xmlns='jabber:client'" +
                    " xmlns:stream='http://etherx.jabber.org/streams'" +
                    " version='1.0'/>"
    );
  });
  this.on('failure', function(stanza, that) {
    that.emit('conn-error', stanza.DOM.firstChild.tagName);
  });
  this.on('challenge', function(stanza, that) {
    //FIXME this is mostly Strophe code

    function _quote(str) {
      return '"' + str.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    };

    var challenge = atob(stanza.DOM.textContent);

    var attribMatch = /([a-z]+)=("[^"]+"|[^,"]+)(?:,|$)/;

    var cnonce = MD5.hexdigest(Math.random() * 1234567890);
    var realm = '';
    var host = null;
    var nonce = '';
    var qop = '';
    var matches;

    while (challenge.match(attribMatch)) {
      matches = challenge.match(attribMatch);
      challenge = challenge.replace(matches[0], '');
      matches[2] = matches[2].replace(/^"(.+)"$/, '$1');
      switch (matches[1]) {
      case 'realm':
          realm = matches[2];
          break;
      case 'nonce':
          nonce = matches[2];
          break;
      case 'qop':
          qop = matches[2];
          break;
      case 'host':
          host = matches[2];
          break;
      }
    }

    var digest_uri = 'xmpp/' + that.jid.domain;
    if (host !== null)
        digest_uri = digest_uri + '/' + host;
    var A1 = MD5.hash(that.jid.node +
                      ':' + realm + ':' + that.password) +
                      ':' + nonce + ':' + cnonce;
    var A2 = 'AUTHENTICATE:' + digest_uri;

    var responseText = '';
    responseText += 'username=' + _quote(that.jid.node) + ',';
    responseText += 'realm=' + _quote(realm) + ',';
    responseText += 'nonce=' + _quote(nonce) + ',';
    responseText += 'cnonce=' + _quote(cnonce) + ',';
    responseText += 'nc="00000001",';
    responseText += 'qop="auth",';
    responseText += 'digest-uri=' + _quote(digest_uri) + ',';
    responseText += 'response=' + _quote(
        MD5.hexdigest(MD5.hexdigest(A1) + ':' +
                      nonce + ':00000001:' +
                      cnonce + ':auth:' +
                      MD5.hexdigest(A2))) + ',';
    responseText += 'charset="utf-8"';
    that.send(
      "<response xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>" +
        btoa(responseText) +
      "</response>");
  });
};
Lightstring.Connection.prototype = {
  /**
   * @function Create and open a websocket then go though the XMPP authentification process.
   * @param {String} [aJid] The JID (Jabber id) to use.
   * @param {String} [aPassword] The associated password.
   */
  connect: function(aJid, aPassword) {
    this.emit('connecting');
    this.jid = new Lightstring.JID(aJid);
    if (aPassword)
      this.password = aPassword;

    if (!this.jid.bare)
      throw 'Lightstring: Connection.jid is undefined.';
    if (!this.password)
      throw 'Lightstring: Connection.password is undefined.';
    if (!this.service)
      throw 'Lightstring: Connection.service is undefined.';

    //"Bug 695635 - tracking bug: unprefix WebSockets" https://bugzil.la/695635
    try {
      this.socket = new WebSocket(this.service, 'xmpp');
    }
    catch (error) {
      this.socket = new MozWebSocket(this.service, 'xmpp');
    }

    var that = this;
    this.socket.addEventListener('open', function() {
      //TODO: if (this.protocol !== 'xmpp')

      var stream = Lightstring.stanza.stream.open(that.jid.domain);
      //TODO: Use Lightstring.Connection.send (problem with parsing steam);
      that.socket.send(stream);
      var stanza = {
        XML: stream
      };
      that.emit('output', stanza);
    });
    this.socket.addEventListener('error', function(e) {
      that.emit('error', e.data);
      console.log(e.data);
    });
    this.socket.addEventListener('close', function(e) {
      that.emit('disconnected', e.data);
    });
    this.socket.addEventListener('message', function(e) {
      var stanza = new Lightstring.Stanza(e.data);

      //TODO node-xmpp-bosh sends a self-closing stream:stream tag; it is wrong!
      that.emit('input', stanza);
      
      if(!stanza.DOM)
        return;
      
      that.emit(stanza.DOM.tagName, stanza);

      if (stanza.DOM.tagName === 'iq') {
        var payload = stanza.DOM.firstChild;
        if (payload)
          that.emit('iq/' + payload.namespaceURI + ':' + payload.localName, stanza);
        that.emit(stanza.DOM.getAttribute('id'), stanza); //FIXME: possible attack vector.
      }
    });
  },
  /**
   * @function Send a message.
   * @param {String|Object} aStanza The message to send.
   * @param {Function} [aCallback] Executed on answer. (stanza must be iq)
   */
  send: function(aStanza, aCallback) {
    if (!(aStanza instanceof Lightstring.Stanza))
      var stanza = new Lightstring.Stanza(aStanza);
    else
      var stanza = aStanza;

    if(!stanza)
      return;

    if (stanza.DOM.tagName === 'iq') {
      var id = stanza.DOM.getAttribute('id');
      //TODO: This should be done by a plugin
      if (!id)
        stanza.DOM.setAttribute('id', Lightstring.newId('sendiq:'));
      if (aCallback)
        this.on(stanza.DOM.getAttribute('id'), aCallback);
    }
    else if (aCallback) {
      this.emit('warning', 'Callback can\'t be called with non-iq stanza.');
    }


    //TODO this.socket.send(stanza.XML); (need some work on Lightstring.Stanza)
    var fixme = Lightstring.DOM2XML(stanza.DOM);
    stanza.XML = fixme;
    this.socket.send(fixme);
    this.emit('output', stanza);
  },
  /**
   * @function Closes the XMPP stream and the socket.
   */
  disconnect: function() {
    this.emit('disconnecting');
    var stream = Lightstring.stanza.stream.close();
    this.send(stream);
    this.emit('XMLOutput', stream);
    this.socket.close();
  },
  /**
   * @function Emits an event.
   * @param {String} aName The event name.
   * @param {Function|Array|Object} [aData] Data about the event.
   */
  emit: function(aName, aData) {
    var handlers = this.handlers[aName];
    if (!handlers)
      return;

    //FIXME Better idea than passing the context as argument?
    for (var i = 0; i < handlers.length; i++)
      handlers[i](aData, this);

    if (aName.match('sendiq:'))
      delete this.handlers[aName];
  },
  /**
   * @function Register an event handler.
   * @param {String} aName The event name.
   * @param {Function} aCallback The callback to call when the event is emitted.
   */
  on: function(aName, callback) {
    if (!this.handlers[aName])
      this.handlers[aName] = [];
    this.handlers[aName].push(callback);
  }
  //FIXME do this!
  //~ this.once = function(name, callback) {
    //~ if(!this.handlers[name])
      //~ this.handlers[name] = [];
    //~ this.handlers[name].push(callback);
  //~ };
};
