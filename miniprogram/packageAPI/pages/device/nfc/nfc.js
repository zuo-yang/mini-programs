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
    writeInput: '',       // 写入内容
    readResult: '',       // 读取结果
    rwBusy: false,        // 是否正在操作中
    rwMode: '',           // 当前操作模式：'write' | 'read' | ''
  },

  // =============================================
  //  日志系统
  // =============================================
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

  // =============================================
  //  读写功能
  // =============================================

  onWriteInputChange(e) {
    this.setData({ writeInput: e.detail.value });
  },

  // 写入
  quickWrite() {
    const text = this.data.writeInput.trim();
    if (!text) {
      wx.showToast({ title: '请输入要写入的内容', icon: 'none' });
      return;
    }
    this.setData({ rwBusy: true, rwMode: 'write', readResult: '' });
    this.addLog(`[写入开始] 内容: "${text}"`);
    this._rwInitAndDiscover('write', text);
  },

  // 读取
  quickRead() {
    this.setData({ rwBusy: true, rwMode: 'read', readResult: '' });
    this.addLog('[读取开始] 请将标签靠近手机...');
    this._rwInitAndDiscover('read');
  },

  // 取消操作
  cancelRW() {
    this.addLog('[取消操作]');
    this._rwCleanup();
  },

  // 内部流程：初始化 → 监听 → 扫描
  _rwInitAndDiscover(mode, text) {
    // Step 1: wx.getNFCAdapter()
    this.addLog('[调用] wx.getNFCAdapter()');
    const adapter = wx.getNFCAdapter();
    if (!adapter) {
      this.addLog('[失败] wx.getNFCAdapter() 返回 null — 设备不支持 NFC 或 NFC 未开启');
      this._rwCleanup();
      return;
    }
    this.addLog('[成功] wx.getNFCAdapter() 获取到适配器实例');
    this.addLog(`   adapter.tech = ${JSON.stringify(Object.keys(adapter.tech || {}))}`);
    this._rwAdapter = adapter;

    // Step 2: adapter.onDiscovered()
    this.addLog('[调用] adapter.onDiscovered(callback) 注册标签发现监听');
    const onDiscovered = (res) => {
      this.addLog('---- onDiscovered 回调触发 ----');
      this.addLog(`   res.id = ${res.id || '(无)'}`);
      this.addLog(`   res.techs = ${JSON.stringify(res.techs)}`);
      if (res.messages && res.messages.length > 0) {
        this.addLog(`   res.messages 共 ${res.messages.length} 条`);
      } else {
        this.addLog('   res.messages = (空)');
      }

      if (mode === 'write') {
        this._doQuickWrite(res, text);
      } else {
        this._doQuickRead(res);
      }
    };

    this._rwDiscoverHandler = onDiscovered;
    adapter.onDiscovered(onDiscovered);

    // Step 3: adapter.startDiscovery()
    this.addLog('[调用] adapter.startDiscovery()');
    adapter.startDiscovery({
      success: (res) => {
        this.addLog(`[成功] adapter.startDiscovery() success: ${JSON.stringify(res)}`);
        this.addLog('   请将 NFC 标签靠近手机...');
      },
      fail: (err) => {
        this.addLog(`[失败] adapter.startDiscovery() fail: ${JSON.stringify(err)}`);
        this._rwCleanup();
      }
    });
  },

  // 写入实现
  _doQuickWrite(res, text) {
    if (!res.techs.includes('ndef')) {
      this.addLog('[失败] 标签协议中不包含 ndef，无法执行 NDEF 写入');
      this._rwCleanup();
      return;
    }

    // Step 4: adapter.getNdef()
    this.addLog('[调用] adapter.getNdef()');
    const ndef = this._rwAdapter.getNdef();
    this.addLog('[成功] adapter.getNdef() 获取到 Ndef 实例');

    // Step 5: ndef.connect()
    this.addLog('[调用] ndef.connect()');
    ndef.connect({
      success: (res) => {
        this.addLog(`[成功] ndef.connect() success: ${JSON.stringify(res)}`);

        // Step 6: ndef.writeNdefMessage()
        const writeParams = { texts: [text] };
        this.addLog(`[调用] ndef.writeNdefMessage(${JSON.stringify(writeParams)})`);
        ndef.writeNdefMessage({
          ...writeParams,
          success: (res) => {
            this.addLog(`[成功] ndef.writeNdefMessage() success: ${JSON.stringify(res)}`);
            this.addLog(`   写入内容: "${text}"`);
            wx.showToast({ title: '写入成功', icon: 'success' });

            // Step 7: ndef.close()
            this.addLog('[调用] ndef.close()');
            ndef.close({
              success: (res) => {
                this.addLog(`[成功] ndef.close() success: ${JSON.stringify(res)}`);
                this._rwCleanup();
              },
              fail: (err) => {
                this.addLog(`[失败] ndef.close() fail: ${JSON.stringify(err)}`);
                this._rwCleanup();
              }
            });
          },
          fail: (err) => {
            this.addLog(`[失败] ndef.writeNdefMessage() fail: ${JSON.stringify(err)}`);
            wx.showToast({ title: '写入失败', icon: 'error' });
            this.addLog('[调用] ndef.close()');
            ndef.close({
              success: (res) => {
                this.addLog(`[成功] ndef.close() success: ${JSON.stringify(res)}`);
                this._rwCleanup();
              },
              fail: (err2) => {
                this.addLog(`[失败] ndef.close() fail: ${JSON.stringify(err2)}`);
                this._rwCleanup();
              }
            });
          }
        });
      },
      fail: (err) => {
        this.addLog(`[失败] ndef.connect() fail: ${JSON.stringify(err)}`);
        this._rwCleanup();
      }
    });
  },

  // 读取实现
  _doQuickRead(res) {
    this.addLog('---- 开始解析 onDiscovered 数据 ----');
    const { techs, messages = [] } = res;
    let readTexts = [];

    // 如果支持 ndef，尝试通过 ndef.connect + onNdefMessage 读取
    if (techs.includes('ndef') && this._rwAdapter) {
      this.addLog('[调用] adapter.getNdef()');
      const ndef = this._rwAdapter.getNdef();
      this.addLog('[成功] adapter.getNdef()');

      this.addLog('[调用] ndef.connect()');
      ndef.connect({
        success: (connectRes) => {
          this.addLog(`[成功] ndef.connect() success: ${JSON.stringify(connectRes)}`);

          // 注册 onNdefMessage 监听
          this.addLog('[调用] ndef.onNdefMessage(callback) 注册 NDEF 消息监听');
          ndef.onNdefMessage((ndefRes) => {
            this.addLog('---- onNdefMessage 回调触发 ----');
            this.addLog(`   回调数据: ${JSON.stringify(ndefRes).substring(0, 300)}`);
            this._parseNdefMessages(ndefRes);
          });

          // 同时解析 onDiscovered 已携带的数据
          if (messages && messages.length > 0) {
            this.addLog(`[数据] onDiscovered 已携带 ${messages.length} 条 messages，直接解析`);
            readTexts = this._parseMessages(messages);
          }

          if (readTexts.length > 0) {
            const result = readTexts.join('\n');
            this.setData({ readResult: result });
            this.addLog(`[成功] 读取完成，共 ${readTexts.length} 条记录`);
            wx.showToast({ title: '读取成功', icon: 'success' });
          } else {
            this.addLog('[等待] onDiscovered 携带的数据中未解析到文本，等待 onNdefMessage...');
            // 设置超时，5 秒后如果还没读到就结束
            this._readTimeout = setTimeout(() => {
              if (!this.data.readResult) {
                this.setData({ readResult: '（未读取到 NDEF 文本数据）' });
                this.addLog('[超时] 读取超时（5s），未收到 onNdefMessage 数据');
              }
              this.addLog('[调用] ndef.close()');
              ndef.close({
                success: (res) => this.addLog(`[成功] ndef.close() success: ${JSON.stringify(res)}`),
                fail: (err) => this.addLog(`[失败] ndef.close() fail: ${JSON.stringify(err)}`),
                complete: () => this._rwCleanup()
              });
            }, 5000);
          }

          // 如果已经有结果了，直接关闭
          if (readTexts.length > 0) {
            this.addLog('[调用] ndef.close()');
            ndef.close({
              success: (res) => this.addLog(`[成功] ndef.close() success: ${JSON.stringify(res)}`),
              fail: (err) => this.addLog(`[失败] ndef.close() fail: ${JSON.stringify(err)}`),
              complete: () => this._rwCleanup()
            });
          }
        },
        fail: (err) => {
          this.addLog(`[失败] ndef.connect() fail: ${JSON.stringify(err)}`);
          // 降级：直接解析 onDiscovered 携带的数据
          this.addLog('[降级] 直接解析 onDiscovered 携带的 messages');
          this._fallbackParseMessages(messages);
          this._rwCleanup();
        }
      });
    } else {
      // 不支持 ndef，直接解析 onDiscovered 携带的数据
      this.addLog('[警告] 标签不支持 ndef 协议，直接解析 onDiscovered 携带的 messages');
      this._fallbackParseMessages(messages);
      this._rwCleanup();
    }
  },

  // UTF-8 解码（兼容 iOS，不依赖 TextDecoder）
  _utf8Decode(uint8Array) {
    let str = '';
    let i = 0;
    while (i < uint8Array.length) {
      let byte1 = uint8Array[i];
      if (byte1 < 0x80) {
        str += String.fromCharCode(byte1);
        i += 1;
      } else if ((byte1 & 0xE0) === 0xC0) {
        let byte2 = uint8Array[i + 1] || 0;
        str += String.fromCharCode(((byte1 & 0x1F) << 6) | (byte2 & 0x3F));
        i += 2;
      } else if ((byte1 & 0xF0) === 0xE0) {
        let byte2 = uint8Array[i + 1] || 0;
        let byte3 = uint8Array[i + 2] || 0;
        str += String.fromCharCode(((byte1 & 0x0F) << 12) | ((byte2 & 0x3F) << 6) | (byte3 & 0x3F));
        i += 3;
      } else if ((byte1 & 0xF8) === 0xF0) {
        let byte2 = uint8Array[i + 1] || 0;
        let byte3 = uint8Array[i + 2] || 0;
        let byte4 = uint8Array[i + 3] || 0;
        let codePoint = ((byte1 & 0x07) << 18) | ((byte2 & 0x3F) << 12) | ((byte3 & 0x3F) << 6) | (byte4 & 0x3F);
        // 处理 surrogate pair（4 字节 UTF-8 对应 BMP 外字符）
        codePoint -= 0x10000;
        str += String.fromCharCode((codePoint >> 10) + 0xD800, (codePoint & 0x3FF) + 0xDC00);
        i += 4;
      } else {
        str += '?';
        i += 1;
      }
    }
    return str;
  },

  // 解析 NDEF messages 数组，返回文本数组
  _parseMessages(messages) {
    let readTexts = [];
    messages.forEach((msg, msgIdx) => {
      this.addLog(`   解析 message[${msgIdx}]: records 数量 = ${(msg.records || []).length}`);
      if (msg.records && msg.records.length > 0) {
        msg.records.forEach((record, recIdx) => {
          if (record.type && record.payload) {
            try {
              const payload = new Uint8Array(record.payload);
              const type = String.fromCharCode.apply(null, new Uint8Array(record.type));
              this.addLog(`   record[${recIdx}]: TNF=${record.tnf || '?'}, type="${type}", payload 长度=${payload.length}`);

              if (type === 'T') {
                const langLen = payload[0];
                const langCode = String.fromCharCode.apply(null, payload.slice(1, 1 + langLen));
                const textBytes = payload.slice(1 + langLen);
                const text = this._utf8Decode(textBytes);
                readTexts.push(text);
                this.addLog(`   [文本记录] lang="${langCode}", text="${text}"`);
              } else if (type === 'U') {
                const uriPrefixes = [
                  '', 'http://www.', 'https://www.', 'http://', 'https://',
                  'tel:', 'mailto:', 'ftp://anonymous:anonymous@', 'ftp://ftp.',
                  'ftps://', 'sftp://', 'smb://', 'nfs://', 'ftp://', 'dav://',
                  'news:', 'telnet://', 'imap:', 'rtsp://', 'urn:', 'pop:',
                  'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://',
                  'btgoep://', 'tcpobex://', 'irdaobex://', 'file://',
                  'urn:epc:id:', 'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:',
                  'urn:epc:', 'urn:nfc:'
                ];
                const prefixCode = payload[0];
                const prefix = uriPrefixes[prefixCode] || '';
                const uri = prefix + this._utf8Decode(payload.slice(1));
                readTexts.push(uri);
                this.addLog(`   [URI记录] prefixCode=${prefixCode}, uri="${uri}"`);
              } else {
                this.addLog(`   [未知类型] "${type}", payload 长度=${payload.length}`);
              }
            } catch (e) {
              this.addLog(`   [异常] 解析 record[${recIdx}]: ${e.message}`);
            }
          } else {
            this.addLog(`   record[${recIdx}]: type 或 payload 为空，跳过`);
          }
        });
      }
    });
    return readTexts;
  },

  // 解析 onNdefMessage 回调数据
  _parseNdefMessages(ndefRes) {
    this.addLog('[解析] onNdefMessage 数据...');
    const messages = ndefRes.messages || (ndefRes.records ? [ndefRes] : []);
    const readTexts = this._parseMessages(messages.length > 0 ? messages : [{ records: ndefRes.records || [] }]);

    if (readTexts.length > 0) {
      const result = readTexts.join('\n');
      this.setData({ readResult: result });
      this.addLog(`[成功] onNdefMessage 读取完成，共 ${readTexts.length} 条记录`);
      wx.showToast({ title: '读取成功', icon: 'success' });
      // 清除超时
      if (this._readTimeout) {
        clearTimeout(this._readTimeout);
        this._readTimeout = null;
      }
    }
  },

  // 降级解析：直接用 onDiscovered 携带的 messages
  _fallbackParseMessages(messages) {
    if (messages && messages.length > 0) {
      this.addLog(`[降级解析] onDiscovered 携带的 ${messages.length} 条 messages`);
      const readTexts = this._parseMessages(messages);
      if (readTexts.length > 0) {
        const result = readTexts.join('\n');
        this.setData({ readResult: result });
        this.addLog(`[成功] 读取完成，共 ${readTexts.length} 条记录`);
        wx.showToast({ title: '读取成功', icon: 'success' });
      } else {
        this.setData({ readResult: '（未读取到 NDEF 文本数据）' });
        this.addLog('[警告] 未解析到 NDEF 文本数据');
        this.addLog(`[数据] 原始 messages: ${JSON.stringify(messages).substring(0, 300)}`);
      }
    } else {
      this.setData({ readResult: '（标签无数据）' });
      this.addLog('[警告] onDiscovered 未携带任何 messages 数据');
    }
  },

  // 清理资源
  _rwCleanup() {
    if (this._readTimeout) {
      clearTimeout(this._readTimeout);
      this._readTimeout = null;
    }
    if (this._rwAdapter) {
      if (this._rwDiscoverHandler) {
        this.addLog('[调用] adapter.offDiscovered() 取消监听');
        this._rwAdapter.offDiscovered(this._rwDiscoverHandler);
        this._rwDiscoverHandler = null;
      }
      this.addLog('[调用] adapter.stopDiscovery()');
      this._rwAdapter.stopDiscovery({
        success: (res) => {
          this.addLog(`[成功] adapter.stopDiscovery() success: ${JSON.stringify(res)}`);
        },
        fail: (err) => {
          this.addLog(`[失败] adapter.stopDiscovery() fail: ${JSON.stringify(err)}`);
        },
        complete: () => {
          this.addLog('[完成] 资源清理完成');
        }
      });
      this._rwAdapter = null;
    }
    this.setData({ rwBusy: false, rwMode: '' });
  },

  // =============================================
  //  生命周期
  // =============================================
  onLoad() {
    this.setData({
      t: i18n,
      lang
    });

    if (wx.onThemeChange) {
      wx.onThemeChange(({ theme }) => {
        this.setData({ theme })
      });
    }

    this.addLog('[初始化] NFC 页面已加载');
  },

  onUnload() {
    this._rwCleanup();
  }
})
