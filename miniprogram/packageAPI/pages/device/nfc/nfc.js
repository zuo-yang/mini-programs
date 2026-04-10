import { i18n, lang } from '../../../../i18n/lang'

// 读写文本时的 tech 优先级（越靠前越优先）
const TECH_PRIORITY = ['ndef', 'mifareUltralight', 'nfcA', 'isoDep', 'mifareClassic', 'nfcB', 'nfcF', 'nfcV']
// const TECH_PRIORITY = ['nfcA']
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

  _utf8Encode(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
      } else if (code >= 0xD800 && code <= 0xDBFF) {
        const hi = code;
        const lo = str.charCodeAt(++i);
        code = ((hi - 0xD800) << 10) + (lo - 0xDC00) + 0x10000;
        bytes.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      } else {
        bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
      }
    }
    return new Uint8Array(bytes);
  },

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

  _extractMessages(messages) {
    const results = [];
    if (!messages) return results;
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg || !msg.records) continue;
      for (let j = 0; j < msg.records.length; j++) {
        const rec = msg.records[j];
        if (!rec) continue;
        let tnf = -1, typeBytes = new Uint8Array(0), payloadBytes = new Uint8Array(0);
        try { tnf = rec.tnf; } catch (e) {}
        try { if (rec.type) typeBytes = new Uint8Array(rec.type); } catch (e) {}
        try { if (rec.payload) payloadBytes = new Uint8Array(rec.payload); } catch (e) {}
        if (payloadBytes.length > 0) {
          const text = this._parseRecord(tnf, typeBytes, payloadBytes);
          if (text) results.push(text);
        }
      }
    }
    return results;
  },

  // =============================================
  //  Tech 自动匹配
  // =============================================

  // 根据标签 tech 名找到 adapter 上对应的 getXxx 方法
  // 例：标签有 "ndef" → 检查 adapter.getNdef 是否是 function → 是就返回
  _getAdapterMethod(tech) {
    const fnName = 'get' + tech.charAt(0).toUpperCase() + tech.slice(1);
    if (typeof this._adapter[fnName] === 'function') {
      return { fnName, fn: this._adapter[fnName].bind(this._adapter) };
    }
    return null;
  },

  // 从标签的 techs 中，按优先级找到一个设备也支持的 tech
  _matchBestTech(tagTechs) {
    this.addLog(`[匹配] 标签支持: ${JSON.stringify(tagTechs)}`);
    for (let i = 0; i < TECH_PRIORITY.length; i++) {
      const tech = TECH_PRIORITY[i];
      if (tagTechs.includes(tech)) {
        const method = this._getAdapterMethod(tech);
        if (method) {
          this.addLog(`[匹配] 选中 ${tech} → adapter.${method.fnName}() ✓`);
          return { tech, getInstance: method.fn };
        }
        this.addLog(`[匹配] 标签有 ${tech} 但 adapter 无对应方法，跳过`);
      }
    }
    // 优先级列表之外的 tech 也试试
    for (let i = 0; i < tagTechs.length; i++) {
      const tech = tagTechs[i];
      const method = this._getAdapterMethod(tech);
      if (method) {
        this.addLog(`[匹配] 选中 ${tech} → adapter.${method.fnName}() ✓`);
        return { tech, getInstance: method.fn };
      }
    }
    this.addLog('[匹配] 设备和标签没有共同支持的 NFC 技术');
    return null;
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
    console.log("【wx.getNFCAdapter()=======》】",adapter)
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
      console.log('【onDiscovered======res》】',res)
      // 第一时间保存 messages 数据（buffer 可能在后续操作中 detach）
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

      // 自动匹配：标签 techs ∩ adapter 方法 → 选最优
      const matched = this._matchBestTech(res.techs);
      if (!matched) {
        this.addLog('[失败] 无法匹配到可用的 NFC 技术');
        wx.showToast({ title: '标签与设备不兼容', icon: 'none' });
        this._cleanup();
        return;
      }

      // 实例化 tech 对象
      this.addLog(`[调用] adapter.${matched.tech} → getInstance()`);
      const techInstance = matched.getInstance();
      this.addLog(`[成功] 获取到 ${matched.tech} 实例`);

      // 根据匹配到的 tech 类型走不同路径
      if (matched.tech === 'ndef') {
        this._handleNdef(techInstance, mode, text, earlyTexts, messagesSnapshot, isIOS);
      } else {
        this._handleTransceive(techInstance, matched.tech, mode, text, earlyTexts, messagesSnapshot);
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
  //  NDEF 路径（writeNdefMessage / onNdefMessage）
  // =============================================
  _handleNdef(ndef, mode, text, earlyTexts, messagesSnapshot, isIOS) {
    if (isIOS) {
      // iOS ndef 不需要 connect
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
      } else {
        this._readNdef(ndef, earlyTexts, messagesSnapshot, true);
      }
    } else {
      // Android ndef 需要 connect → 操作 → close
      this._connectTech(ndef, 'ndef', () => {
        if (mode === 'write') {
          this.addLog(`[调用] ndef.writeNdefMessage({ texts: ["${text}"] })`);
          ndef.writeNdefMessage({
            texts: [text],
            success: (res) => {
              this.addLog(`[成功] ndef.writeNdefMessage(): ${JSON.stringify(res)}`);
              wx.showToast({ title: '写入成功', icon: 'success' });
              this._closeTech(ndef);
            },
            fail: (err) => {
              this.addLog(`[失败] ndef.writeNdefMessage(): ${JSON.stringify(err)}`);
              wx.showToast({ title: '写入失败', icon: 'error' });
              this._closeTech(ndef);
            }
          });
        } else {
          this._readNdef(ndef, earlyTexts, messagesSnapshot, false);
        }
      });
    }
  },

  // NDEF 读取（iOS 和 Android 共用，通过 isIOS 区分关闭方式）
  _readNdef(ndef, earlyTexts, messagesSnapshot, isIOS) {
    const done = () => isIOS ? this._closeTechThenCleanup(ndef) : this._closeTech(ndef);

    // 优先级1：onDiscovered 直接提取
    if (earlyTexts && earlyTexts.length > 0) {
      this.setData({ readResult: earlyTexts.join('\n') });
      this.addLog(`[成功] 从 onDiscovered 读取到 ${earlyTexts.length} 条记录`);
      wx.showToast({ title: '读取成功', icon: 'success' });
      done();
      return;
    }
    // 优先级2：JSON 快照
    if (messagesSnapshot) {
      try {
        const parsed = JSON.parse(messagesSnapshot);
        const texts = this._parseMessagesFromJSON(parsed);
        if (texts.length > 0) {
          this.setData({ readResult: texts.join('\n') });
          this.addLog(`[成功] 从 JSON 快照读取到 ${texts.length} 条记录`);
          wx.showToast({ title: '读取成功', icon: 'success' });
          done();
          return;
        }
      } catch (e) {}
    }
    // 优先级3：onNdefMessage 等待
    this.addLog('[调用] ndef.onNdefMessage(callback) 注册 NDEF 消息监听');
    ndef.onNdefMessage((ndefRes) => {
      this.addLog('---- onNdefMessage 回调触发 ----');
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
      if (this._readTimeout) { clearTimeout(this._readTimeout); this._readTimeout = null; }
      done();
    });
    this._readTimeout = setTimeout(() => {
      if (!this.data.readResult) {
        this.setData({ readResult: '（未读取到数据）' });
        this.addLog('[超时] 读取超时（5s），未收到 onNdefMessage');
      }
      done();
    }, 5000);
  },

  // =============================================
  //  Transceive 路径（非 ndef tech，用原始指令读写）
  // =============================================
  _handleTransceive(techInstance, techName, mode, text, earlyTexts, messagesSnapshot) {
    this._connectTech(techInstance, techName, () => {
      if (mode === 'write') {
        this._writeTransceive(techInstance, techName, text);
      } else {
        this._readTransceive(techInstance, techName, earlyTexts, messagesSnapshot);
      }
    });
  },

  // transceive 写入 NDEF（MifareUltralight WRITE 指令）
  _writeTransceive(techInstance, techName, text) {
    // 构建 NDEF Text Record TLV
    const langCode = 'en';
    const langBytes = this._utf8Encode(langCode);
    const textBytes = this._utf8Encode(text);
    const payload = new Uint8Array(1 + langBytes.length + textBytes.length);
    payload[0] = langBytes.length;
    payload.set(langBytes, 1);
    payload.set(textBytes, 1 + langBytes.length);

    const ndefRecord = new Uint8Array(3 + 1 + payload.length);
    ndefRecord[0] = 0xD1; // MB=1,ME=1,SR=1,TNF=1
    ndefRecord[1] = 1;    // type length
    ndefRecord[2] = payload.length;
    ndefRecord[3] = 0x54; // 'T'
    ndefRecord.set(payload, 4);

    const tlv = new Uint8Array(2 + ndefRecord.length + 1);
    tlv[0] = 0x03;
    tlv[1] = ndefRecord.length;
    tlv.set(ndefRecord, 2);
    tlv[2 + ndefRecord.length] = 0xFE;

    this.addLog(`[写入] 通过 ${techName} transceive 写入 ${tlv.length} 字节`);

    // 每页 4 字节，从 page 4 开始
    const startPage = 4;
    let pageIdx = 0;
    const totalPages = Math.ceil(tlv.length / 4);

    const writePage = () => {
      if (pageIdx >= totalPages) {
        this.addLog(`[成功] transceive 写入完成，共 ${totalPages} 页`);
        wx.showToast({ title: '写入成功', icon: 'success' });
        this._closeTech(techInstance);
        return;
      }
      const offset = pageIdx * 4;
      const cmd = new Uint8Array(6);
      cmd[0] = 0xA2; // WRITE
      cmd[1] = startPage + pageIdx;
      for (let i = 0; i < 4; i++) cmd[2 + i] = offset + i < tlv.length ? tlv[offset + i] : 0;

      this.addLog(`[调用] ${techName}.transceive() 写入 page ${startPage + pageIdx}`);
      techInstance.transceive({
        data: cmd.buffer,
        success: () => {
          this.addLog(`[成功] page ${startPage + pageIdx} 写入完成`);
          pageIdx++;
          writePage();
        },
        fail: (err) => {
          this.addLog(`[失败] page ${startPage + pageIdx} 写入失败: ${JSON.stringify(err)}`);
          wx.showToast({ title: '写入失败', icon: 'error' });
          this._closeTech(techInstance);
        }
      });
    };
    writePage();
  },

  // transceive 读取
  _readTransceive(techInstance, techName, earlyTexts, messagesSnapshot) {
    // 先尝试已提取的数据
    if (earlyTexts && earlyTexts.length > 0) {
      console.log("[【earlyTexts】",earlyTexts)
      this.setData({ readResult: earlyTexts.join('\n') });
      this.addLog(`[成功] 从 onDiscovered 读取到 ${earlyTexts.length} 条记录`);
      wx.showToast({ title: '读取成功', icon: 'success' });
      this._closeTech(techInstance);
      return;
    }
    if (messagesSnapshot) {
      try {
        const parsed = JSON.parse(messagesSnapshot);
        const texts = this._parseMessagesFromJSON(parsed);
        console.log("【texts】=====",texts);
        if (texts.length > 0) {
          this.setData({ readResult: texts.join('\n') });
          this.addLog(`[成功] 从 JSON 快照读取到 ${texts.length} 条记录`);
          wx.showToast({ title: '读取成功', icon: 'success' });
          this._closeTech(techInstance);
          return;
        }
      } catch (e) {}
    }

    // 通过 transceive READ 指令读取（从 page 4 开始，读 16 字节）
    this.addLog(`[调用] ${techName}.transceive() READ page 4`);
    techInstance.transceive({
      data: new Uint8Array([0x30, 0x04]).buffer,
      success: (res) => {
        const data = new Uint8Array(res.data);
        this.addLog(`[成功] transceive 读取到 ${data.length} 字节`);
        // 解析 NDEF TLV
        const texts = this._parseNdefTLV(data);
        if (texts.length > 0) {
          this.setData({ readResult: texts.join('\n') });
          this.addLog(`[成功] transceive 解析到 ${texts.length} 条记录`);
          wx.showToast({ title: '读取成功', icon: 'success' });
        } else {
          this.setData({ readResult: '（未解析到文本数据）' });
          this.addLog('[警告] transceive 数据中未解析到 NDEF 文本');
        }
        this._closeTech(techInstance);
      },
      fail: (err) => {
        this.addLog(`[失败] ${techName}.transceive(): ${JSON.stringify(err)}`);
        this.setData({ readResult: '（读取失败）' });
        this._closeTech(techInstance);
      }
    });
  },

  // 从原始字节中解析 NDEF TLV 格式
  _parseNdefTLV(data) {
    const texts = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === 0xFE) break;
      if (data[i] === 0x00) { i++; continue; }
      if (i + 1 >= data.length) break;
      const tlvLen = data[i + 1];
      if (data[i] === 0x03 && tlvLen > 3) {
        const rec = data.slice(i + 2, i + 2 + tlvLen);
        const tnf = rec[0] & 0x07;
        const typeLen = rec[1];
        const payloadLen = rec[2];
        if (3 + typeLen + payloadLen <= rec.length) {
          const text = this._parseRecord(tnf, rec.slice(3, 3 + typeLen), rec.slice(3 + typeLen, 3 + typeLen + payloadLen));
          if (text) texts.push(text);
        }
      }
      i += 2 + tlvLen;
    }
    return texts;
  },

  // =============================================
  //  连接 / 关闭（处理 already connected）
  // =============================================
  _connectTech(techInstance, techName, onSuccess) {
    this.addLog(`[调用] ${techName}.connect()`);
    techInstance.connect({
      success: (res) => {
        this.addLog(`[成功] ${techName}.connect(): ${JSON.stringify(res)}`);
        onSuccess();
      },
      fail: (err) => {
        if (err.errCode === 13022) {
          this.addLog(`[提示] ${techName} 已连接，继续操作`);
          onSuccess();
          return;
        }
        this.addLog(`[失败] ${techName}.connect(): ${JSON.stringify(err)}`);
        this._cleanup();
      }
    });
  },

  _closeTech(techInstance) {
    this.addLog('[调用] tech.close()');
    techInstance.close({
      success: (res) => this.addLog(`[成功] tech.close(): ${JSON.stringify(res)}`),
      fail: (err) => this.addLog(`[失败] tech.close(): ${JSON.stringify(err)}`),
      complete: () => this._cleanup()
    });
  },

  _closeTechThenCleanup(techInstance) {
    this.addLog('[调用] tech.close()');
    techInstance.close({
      success: (res) => this.addLog(`[成功] tech.close(): ${JSON.stringify(res)}`),
      fail: (err) => this.addLog(`[失败] tech.close(): ${JSON.stringify(err)}`),
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
