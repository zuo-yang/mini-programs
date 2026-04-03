import { i18n, lang } from '../../../../i18n/lang'

Page({
  onShareAppMessage() {
    return {
      title: 'NFC',
      path: 'packageAPI/pages/device/nfc2/nfc2'
    }
  },

  data: {
    theme: 'light',
    logMessages: [],
    writeInput: '',
    readResult: '',
    rwBusy: false,
    rwMode: '',
  },

  // =============================================
  //  工具方法
  // =============================================
  _isIOS() {
    if (this._platform === undefined) {
      this._platform = wx.getSystemInfoSync().platform;
    }
    return this._platform === 'ios';
  },

  addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    const logs = this.data.logMessages.concat(logEntry);
    if (logs.length > 100) logs.shift();
    this.setData({ logMessages: logs });
    console.log(logEntry);
  },

  clearLog() {
    this.setData({ logMessages: [] });
  },

  _base64ToUint8Array(base64) {
    if (!base64) return new Uint8Array(0);
    let str = base64.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4 !== 0) str += '=';
    const binaryStr = atob(str);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes;
  },

  _utf8Decode(uint8Array) {
    let str = '';
    let i = 0;
    while (i < uint8Array.length) {
      const byte1 = uint8Array[i];
      if (byte1 < 0x80) {
        str += String.fromCharCode(byte1);
        i += 1;
      } else if ((byte1 & 0xE0) === 0xC0) {
        str += String.fromCharCode(((byte1 & 0x1F) << 6) | ((uint8Array[i + 1] || 0) & 0x3F));
        i += 2;
      } else if ((byte1 & 0xF0) === 0xE0) {
        str += String.fromCharCode(((byte1 & 0x0F) << 12) | (((uint8Array[i + 1] || 0) & 0x3F) << 6) | ((uint8Array[i + 2] || 0) & 0x3F));
        i += 3;
      } else if ((byte1 & 0xF8) === 0xF0) {
        let cp = ((byte1 & 0x07) << 18) | (((uint8Array[i + 1] || 0) & 0x3F) << 12) | (((uint8Array[i + 2] || 0) & 0x3F) << 6) | ((uint8Array[i + 3] || 0) & 0x3F);
        cp -= 0x10000;
        str += String.fromCharCode((cp >> 10) + 0xD800, (cp & 0x3FF) + 0xDC00);
        i += 4;
      } else {
        str += '?';
        i += 1;
      }
    }
    return str;
  },

  // 从 JSON 序列化后的对象中提取 buffer（兼容 Android __nativeBuffers__ base64 格式）
  _extractBufferFromJSON(obj) {
    if (!obj) return new Uint8Array(0);
    if (obj.__nativeBuffers__ && Array.isArray(obj.__nativeBuffers__)) {
      const nb = obj.__nativeBuffers__[0];
      if (nb && nb.base64) return this._base64ToUint8Array(nb.base64);
      return new Uint8Array(0);
    }
    if (Array.isArray(obj)) return new Uint8Array(obj);
    if (typeof obj === 'string' && obj.length > 0) return this._base64ToUint8Array(obj);
    return new Uint8Array(0);
  },

  // 解析单条 NDEF record
  _parseRecord(tnf, typeBytes, payloadBytes) {
    if (payloadBytes.length === 0) return null;
    const typeStr = typeBytes.length > 0 ? String.fromCharCode.apply(null, typeBytes) : '';
    this.addLog(`   record: TNF=${tnf}, type="${typeStr}", payload长度=${payloadBytes.length}`);

    try {
      if (typeStr === 'T') {
        const langLen = payloadBytes[0] & 0x3F;
        const text = this._utf8Decode(payloadBytes.slice(1 + langLen));
        this.addLog(`   [文本] "${text}"`);
        return text;
      }
      if (typeStr === 'U') {
        const prefixes = ['', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:'];
        const uri = (prefixes[payloadBytes[0]] || '') + this._utf8Decode(payloadBytes.slice(1));
        this.addLog(`   [URI] "${uri}"`);
        return uri;
      }
      if (tnf === 1 && typeStr === '' && payloadBytes.length > 1) {
        const langLen = payloadBytes[0] & 0x3F;
        if (langLen < payloadBytes.length - 1) {
          const text = this._utf8Decode(payloadBytes.slice(1 + langLen));
          if (text) { this.addLog(`   [文本(推测)] "${text}"`); return text; }
        }
      }
      const raw = this._utf8Decode(payloadBytes);
      if (raw) { this.addLog(`   [原始] "${raw}"`); return raw; }
    } catch (e) {
      this.addLog(`   [解析异常] ${e.message}`);
    }
    return null;
  },

  // 从 JSON.parse 后的 messages 数组解析文本
  _parseMessagesFromJSON(parsedMessages) {
    const texts = [];
    if (!Array.isArray(parsedMessages)) return texts;
    parsedMessages.forEach((msg) => {
      (msg.records || []).forEach((record) => {
        const text = this._parseRecord(
          record.tnf !== undefined ? record.tnf : -1,
          this._extractBufferFromJSON(record.type),
          this._extractBufferFromJSON(record.payload)
        );
        if (text) texts.push(text);
      });
    });
    return texts;
  },

  // 从 onDiscovered 的 messages 中直接提取文本（第一时间调用）
  _extractMessages(messages) {
    const results = [];
    if (!messages) return results;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || !msg.records) continue;
      for (let j = 0; j < msg.records.length; j++) {
        const rec = msg.records[j];
        let tnf = -1, typeBytes = new Uint8Array(0), payloadBytes = new Uint8Array(0);
        try { tnf = rec.tnf; } catch (e) {}
        try { typeBytes = new Uint8Array(rec.type); } catch (e) {}
        try { payloadBytes = new Uint8Array(rec.payload); } catch (e) {}
        if (payloadBytes.length > 0) {
          const text = this._parseRecord(tnf, typeBytes, payloadBytes);
          if (text) results.push(text);
        }
      }
    }
    return results;
  },

  // =============================================
  //  读写入口
  // =============================================
  onWriteInputChange(e) {
    this.setData({ writeInput: e.detail.value });
  },

  quickWrite() {
    const text = this.data.writeInput.trim();
    if (!text) {
      wx.showToast({ title: '请输入要写入的内容', icon: 'none' });
      return;
    }
    this.setData({ rwBusy: true, rwMode: 'write', readResult: '' });
    this.addLog(`[写入开始] 内容: "${text}"`);
    this._startNFC('write', text);
  },

  quickRead() {
    this.setData({ rwBusy: true, rwMode: 'read', readResult: '' });
    this.addLog('[读取开始] 请将标签靠近手机...');
    this._startNFC('read');
  },

  cancelRW() {
    this.addLog('[取消操作]');
    this._cleanup();
  },

  // =============================================
  //  核心流程
  // =============================================
  _startNFC(mode, text) {
    this.addLog('[调用] wx.getNFCAdapter()');
    const adapter = wx.getNFCAdapter();
    if (!adapter) {
      this.addLog('[失败] wx.getNFCAdapter() 返回空，设备不支持 NFC 或未开启');
      this._cleanup();
      return;
    }
    this.addLog('[成功] wx.getNFCAdapter() 获取到适配器实例');
    this._adapter = adapter;
    const isIOS = this._isIOS();
    this.addLog(`[平台] ${isIOS ? 'iOS' : 'Android'}`);

    this.addLog('[调用] adapter.onDiscovered(callback) 注册标签发现监听');
    const onDiscovered = (res) => {
      // *** 第一时间保存数据（buffer 可能在后续操作中 detach）***
      let earlyTexts = null;
      let messagesSnapshot = null;
      if (mode === 'read' && res.messages) {
        earlyTexts = this._extractMessages(res.messages);
        try { messagesSnapshot = JSON.stringify(res.messages); } catch (e) {}
      }

      this.addLog('---- onDiscovered 回调触发 ----');
      this.addLog(`   res.techs = ${JSON.stringify(res.techs)}`);
      if (mode === 'read') {
        this.addLog(`   res.messages 共 ${res.messages ? res.messages.length : 0} 条`);
        this.addLog(`   直接提取结果: ${earlyTexts ? earlyTexts.length : 0} 条`);
      }

      if (!res.techs.includes('ndef')) {
        this.addLog('[失败] 标签不支持 NDEF 协议');
        this._cleanup();
        return;
      }

      if (isIOS) {
        this._handleIOS(mode, text, earlyTexts);
      } else {
        this._handleAndroid(mode, text, earlyTexts, messagesSnapshot);
      }
    };

    this._discoverHandler = onDiscovered;
    adapter.onDiscovered(onDiscovered);

    this.addLog('[调用] adapter.startDiscovery()');
    adapter.startDiscovery({
      success: (res) => {
        this.addLog(`[成功] adapter.startDiscovery(): ${JSON.stringify(res)}`);
        this.addLog('请将 NFC 标签靠近手机...');
      },
      fail: (err) => {
        this.addLog(`[失败] adapter.startDiscovery(): ${JSON.stringify(err)}`);
        this._cleanup();
      }
    });
  },

  // =============================================
  //  iOS（写入不需要 connect，读取从 onDiscovered 提取）
  // =============================================
  _handleIOS(mode, text, earlyTexts) {
    this.addLog('[调用] adapter.getNdef()');
    const ndef = this._adapter.getNdef();
    this.addLog('[成功] adapter.getNdef()');

    if (mode === 'write') {
      this.addLog(`[调用] ndef.writeNdefMessage({ texts: ["${text}"] })`);
      ndef.writeNdefMessage({
        texts: [text],
        success: (res) => {
          this.addLog(`[成功] ndef.writeNdefMessage(): ${JSON.stringify(res)}`);
          wx.showToast({ title: '写入成功', icon: 'success' });
          this._cleanup();
        },
        fail: (err) => {
          this.addLog(`[失败] ndef.writeNdefMessage(): ${JSON.stringify(err)}`);
          wx.showToast({ title: '写入失败', icon: 'error' });
          this._cleanup();
        }
      });
      return;
    }

    // iOS 读取：优先用 onDiscovered 早期提取的数据
    if (earlyTexts && earlyTexts.length > 0) {
      this.setData({ readResult: earlyTexts.join('\n') });
      this.addLog(`[成功] 从 onDiscovered 读取到 ${earlyTexts.length} 条记录`);
      wx.showToast({ title: '读取成功', icon: 'success' });
      this._cleanup();
      return;
    }

    // 降级：connect + onNdefMessage
    this.addLog('[调用] ndef.connect()');
    ndef.connect({
      success: (res) => {
        this.addLog(`[成功] ndef.connect(): ${JSON.stringify(res)}`);
        this.addLog('[调用] ndef.onNdefMessage(callback) 注册 NDEF 消息监听');
        ndef.onNdefMessage((ndefRes) => {
          this.addLog('---- onNdefMessage 回调触发 ----');
          this._handleNdefMessageResult(ndefRes);
          if (this._readTimeout) { clearTimeout(this._readTimeout); this._readTimeout = null; }
          this.addLog('[调用] ndef.close()');
          ndef.close({
            success: (r) => this.addLog(`[成功] ndef.close(): ${JSON.stringify(r)}`),
            fail: (e) => this.addLog(`[失败] ndef.close(): ${JSON.stringify(e)}`),
            complete: () => this._cleanup()
          });
        });
        this._readTimeout = setTimeout(() => {
          if (!this.data.readResult) {
            this.setData({ readResult: '（未读取到数据）' });
            this.addLog('[超时] 读取超时（5s），未收到 onNdefMessage');
          }
          this.addLog('[调用] ndef.close()');
          ndef.close({
            success: (r) => this.addLog(`[成功] ndef.close(): ${JSON.stringify(r)}`),
            fail: (e) => this.addLog(`[失败] ndef.close(): ${JSON.stringify(e)}`),
            complete: () => this._cleanup()
          });
        }, 5000);
      },
      fail: (err) => {
        this.addLog(`[失败] ndef.connect(): ${JSON.stringify(err)}`);
        this.setData({ readResult: '（读取失败）' });
        this._cleanup();
      }
    });
  },

  // =============================================
  //  Android（需要 connect/close）
  // =============================================
  _handleAndroid(mode, text, earlyTexts, messagesSnapshot) {
    this.addLog('[调用] adapter.getNdef()');
    const ndef = this._adapter.getNdef();
    this.addLog('[成功] adapter.getNdef()');

    this.addLog('[调用] ndef.connect()');
    ndef.connect({
      success: (connectRes) => {
        this.addLog(`[成功] ndef.connect(): ${JSON.stringify(connectRes)}`);

        if (mode === 'write') {
          this.addLog(`[调用] ndef.writeNdefMessage({ texts: ["${text}"] })`);
          ndef.writeNdefMessage({
            texts: [text],
            success: (res) => {
              this.addLog(`[成功] ndef.writeNdefMessage(): ${JSON.stringify(res)}`);
              wx.showToast({ title: '写入成功', icon: 'success' });
              this._closeNdef(ndef);
            },
            fail: (err) => {
              this.addLog(`[失败] ndef.writeNdefMessage(): ${JSON.stringify(err)}`);
              wx.showToast({ title: '写入失败', icon: 'error' });
              this._closeNdef(ndef);
            }
          });
          return;
        }

        // 读取优先级1：直接 buffer 提取（onDiscovered 时已完成）
        if (earlyTexts && earlyTexts.length > 0) {
          this.setData({ readResult: earlyTexts.join('\n') });
          this.addLog(`[成功] 从 onDiscovered 读取到 ${earlyTexts.length} 条记录`);
          wx.showToast({ title: '读取成功', icon: 'success' });
          this._closeNdef(ndef);
          return;
        }

        // 读取优先级2：JSON 快照（兼容 __nativeBuffers__ base64 格式）
        if (messagesSnapshot) {
          try {
            const parsed = JSON.parse(messagesSnapshot);
            const texts = this._parseMessagesFromJSON(parsed);
            if (texts.length > 0) {
              this.setData({ readResult: texts.join('\n') });
              this.addLog(`[成功] 从 JSON 快照读取到 ${texts.length} 条记录`);
              wx.showToast({ title: '读取成功', icon: 'success' });
              this._closeNdef(ndef);
              return;
            }
          } catch (e) {}
        }

        // 读取优先级3：注册 onNdefMessage 等待
        this.addLog('[调用] ndef.onNdefMessage(callback) 注册 NDEF 消息监听');
        ndef.onNdefMessage((ndefRes) => {
          this.addLog('---- onNdefMessage 回调触发 ----');
          this._handleNdefMessageResult(ndefRes);
          if (this._readTimeout) { clearTimeout(this._readTimeout); this._readTimeout = null; }
          this._closeNdef(ndef);
        });
        this._readTimeout = setTimeout(() => {
          if (!this.data.readResult) {
            this.setData({ readResult: '（未读取到数据）' });
            this.addLog('[超时] 读取超时（5s），未收到 onNdefMessage');
          }
          this._closeNdef(ndef);
        }, 5000);
      },
      fail: (err) => {
        this.addLog(`[失败] ndef.connect(): ${JSON.stringify(err)}`);
        this._cleanup();
      }
    });
  },

  // =============================================
  //  公共方法
  // =============================================
  _handleNdefMessageResult(ndefRes) {
    try {
      const parsed = JSON.parse(JSON.stringify(ndefRes));
      const msgs = parsed.messages || (parsed.records ? [parsed] : []);
      const texts = this._parseMessagesFromJSON(msgs);
      if (texts.length > 0) {
        this.setData({ readResult: texts.join('\n') });
        this.addLog(`[成功] onNdefMessage 读取到 ${texts.length} 条记录`);
        wx.showToast({ title: '读取成功', icon: 'success' });
      }
    } catch (e) {
      this.addLog(`[异常] 解析 onNdefMessage: ${e.message}`);
    }
  },

  _closeNdef(ndef) {
    this.addLog('[调用] ndef.close()');
    ndef.close({
      success: (res) => this.addLog(`[成功] ndef.close(): ${JSON.stringify(res)}`),
      fail: (err) => this.addLog(`[失败] ndef.close(): ${JSON.stringify(err)}`),
      complete: () => this._cleanup()
    });
  },

  _cleanup() {
    if (this._readTimeout) {
      clearTimeout(this._readTimeout);
      this._readTimeout = null;
    }
    if (this._adapter) {
      if (this._discoverHandler) {
        this.addLog('[调用] adapter.offDiscovered() 取消监听');
        this._adapter.offDiscovered(this._discoverHandler);
        this._discoverHandler = null;
      }
      this.addLog('[调用] adapter.stopDiscovery()');
      this._adapter.stopDiscovery({
        success: (res) => this.addLog(`[成功] adapter.stopDiscovery(): ${JSON.stringify(res)}`),
        fail: (err) => this.addLog(`[失败] adapter.stopDiscovery(): ${JSON.stringify(err)}`),
        complete: () => this.addLog('[完成] 资源清理完成')
      });
      this._adapter = null;
    }
    this.setData({ rwBusy: false, rwMode: '' });
  },

  // =============================================
  //  生命周期
  // =============================================
  onLoad() {
    this.setData({ t: i18n, lang });
    if (wx.onThemeChange) {
      wx.onThemeChange(({ theme }) => this.setData({ theme }));
    }
    this.addLog('[初始化] NFC 页面已加载');
  },

  onUnload() {
    this._cleanup();
  }
})
