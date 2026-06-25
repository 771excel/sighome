import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

document.addEventListener('alpine:init', () => {
    Alpine.data('signatureApp', () => ({
        lastModified: '',
        isDownloading: false,
        activeTab: 'basic', 
        
        toastMessage: '',
        toastTimeout: null,
        
        appId: null,
        userId: null,
        db: null,
        isSyncing: false,
        _unsubscribe: null, 
        
        isDarkMode: true,
        isViewerMode: false,

        modalOpen: false,
        modalItem: null,
        isGifLoading: false,
        
        globalVolume: 0.5, 

        newGroupName: '',
        newGroupStart: '',
        newGroupEnd: '',
        newGroupColor: '#3B82F6',
        editingGroupId: null,
        editGroupData: { name: '', start: '', end: '', color: '' },

        newEventTitle: '',
        newEventTargets: '',
        newEventColor: '#F59E0B', 
        
        editingEventId: null,
        editEventData: { title: '', targets: '', color: '' },

        newMemberName: '',
        
        activeAddTab: 'folder',
        newSigId: '',
        newSigName: '',
        newSigMedia: '',
        newSigAudio: '',

        webAssetBaseUrl: './assets/',
        webAssetImgExt: '.gif',
        webAssetAudioExt: '.mp3',

        detailFilter: 'all',
        searchQuery: '', 
        
        zoomLevel: window.innerWidth >= 1024 ? 4 : 3,
        zoomIn() { if (this.zoomLevel < 5) this.zoomLevel++; },
        zoomOut() { if (this.zoomLevel > 1) this.zoomLevel--; },
        
        get zoomGridClass() {
            if (!this.isViewerMode) return 'grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6';
            const maps = {
                1: 'grid-cols-4 sm:grid-cols-6 md:grid-cols-9 lg:grid-cols-11',
                2: 'grid-cols-3 sm:grid-cols-5 md:grid-cols-8 lg:grid-cols-10',
                3: 'grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8',
                4: 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6',
                5: 'grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-5'
            };
            return maps[this.zoomLevel] || maps[3];
        },
        get zoomTextClassId() {
            if (!this.isViewerMode) return 'text-lg md:text-xl';
            const maps = { 1: 'text-[10px] md:text-xs', 2: 'text-xs md:text-sm', 3: 'text-sm md:text-base', 4: 'text-base md:text-lg', 5: 'text-lg md:text-xl' };
            return maps[this.zoomLevel] || maps[3];
        },
        get zoomTextClassName() {
            if (!this.isViewerMode) return 'text-lg md:text-xl';
            const maps = { 1: 'text-xs md:text-sm', 2: 'text-sm md:text-base', 3: 'text-base md:text-lg', 4: 'text-lg md:text-xl', 5: 'text-xl md:text-2xl' };
            return maps[this.zoomLevel] || maps[3];
        },
        
        groups: [{ id: 'g_default', name: '기본 목록 (미분류)', start: null, end: null, color: '#6B7280' }],
        events: [], 
        members: [], 
        items: [], 

        async init() {
            const d = new Date();
            this.lastModified = `${d.getFullYear().toString().slice(-2)}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
            
            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.get('viewer') === 'true') {
                this.isViewerMode = true;
                document.addEventListener('contextmenu', e => e.preventDefault());
                document.addEventListener('dragstart', e => e.preventDefault());
                document.addEventListener('selectstart', e => e.preventDefault());
            }

            this.initDragScroll(); 
            await this.initFirebase();
        },

        upgradeHttps(url) {
            if (!url) return '';
            return url.replace(/^http:\/\//i, 'https://');
        },

        autoParseLink() {
            let audioUrl = this.newSigAudio.trim();
            let mediaUrl = this.newSigMedia.trim();

            let bestId = '';
            let bestName = '';

            const extract = (url) => {
                if(!url) return null;
                try {
                    let decoded = decodeURI(url);
                    let filename = decoded.split('/').pop().split('?')[0];
                    const match = filename.match(/^(\d+)[_.\-\s]+(.*?)(?:\.[a-zA-Z0-9]+)?$/);
                    if (match) return { id: match[1], name: match[2].trim() };
                    const matchId = filename.match(/^(\d+)(?:\.[a-zA-Z0-9]+)?$/);
                    if (matchId) return { id: matchId[1], name: '' };
                } catch(e) {}
                return null;
            };

            let aData = extract(audioUrl);
            let mData = extract(mediaUrl);

            if (aData && aData.id) {
                bestId = aData.id;
                if (aData.name) bestName = aData.name;
            }
            if (mData && mData.id) {
                if (!bestId) bestId = mData.id; 
                if (!bestName && mData.name) bestName = mData.name; 
            }

            if (bestId) this.newSigId = bestId;
            if (bestName && !this.newSigName) this.newSigName = bestName;
        },

        async addIndividualSignature() {
            const id = parseInt(this.newSigId);
            if (isNaN(id) || id <= 0) {
                this.showToast("🚨 단가(번호)를 정확히 추출하거나 직접 입력해주세요.");
                return;
            }
            
            let mediaUrl = this.upgradeHttps(this.newSigMedia.trim());
            let audioUrl = this.upgradeHttps(this.newSigAudio.trim());
            let name = this.newSigName.trim() || `${id}번 시그니처`;

            let existingItem = this.items.find(x => x.id === id);
            
            if (existingItem) {
                existingItem.name = name;
                if (mediaUrl) {
                    existingItem.mediaUrl = mediaUrl;
                    existingItem.originalGifUrl = mediaUrl;
                    if (!existingItem.isFrozen || !existingItem.frozenDataUrl) existingItem.imgUrl = mediaUrl;
                    existingItem.hasImage = true;
                    existingItem.isGif = mediaUrl.toLowerCase().includes('.gif');
                }
                if (audioUrl) {
                    existingItem.audioUrl = audioUrl;
                    existingItem.hasAudio = true;
                }
            } else {
                this.items.push({
                    id: id,
                    name: name,
                    imgUrl: mediaUrl || this.getPlaceholderImage(),
                    audioUrl: audioUrl || '',
                    mediaUrl: mediaUrl || '',
                    hasAudio: !!audioUrl,
                    hasImage: !!mediaUrl,
                    isGif: mediaUrl ? mediaUrl.toLowerCase().includes('.gif') : false,
                    isFrozen: false,
                    originalGifUrl: mediaUrl || '',
                    frozenDataUrl: null,
                    isNew: true,
                    isPersonal: false,
                    memberId: '',
                    groupId: this.findGroupForId(id)
                });
            }
            
            this.items.sort((a, b) => a.id - b.id);
            await this.saveCloudData(); 
            
            this.newSigId = '';
            this.newSigName = '';
            this.newSigMedia = '';
            this.newSigAudio = '';
            this.showToast(`✨ ${id}번 시그니처가 성공적으로 반영되었습니다.`);
        },

        removeItem(id) {
            if (confirm(`${id}번 시그니처를 정말 삭제하시겠습니까?`)) {
                this.items = this.items.filter(i => i.id !== id);
                this.saveCloudData();
                this.showToast(`🗑️ ${id}번 시그니처가 삭제되었습니다.`);
            }
        },

        updateMediaUrl(item) {
            if (item.mediaUrl) {
                let safeUrl = this.upgradeHttps(item.mediaUrl.trim());
                item.mediaUrl = safeUrl;
                item.imgUrl = safeUrl;
                item.hasImage = true;
                item.isGif = safeUrl.toLowerCase().includes('.gif');
            } else {
                item.imgUrl = this.getPlaceholderImage();
                item.hasImage = false;
                item.isGif = false;
            }
            this.saveCloudData();
        },

        updateAudioUrl(item) {
            if (item.audioUrl) {
                let safeUrl = this.upgradeHttps(item.audioUrl.trim());
                item.audioUrl = safeUrl;
                item.hasAudio = true;
            } else {
                item.hasAudio = false;
            }
            this.saveCloudData();
        },
        
        updateVolume() {
            document.querySelectorAll('audio').forEach(a => a.volume = this.globalVolume);
        },

        showToast(msg) {
            this.toastMessage = msg;
            if(this.toastTimeout) clearTimeout(this.toastTimeout);
            this.toastTimeout = setTimeout(() => { this.toastMessage = ''; }, 4000);
        },

        initDragScroll() {
            const attach = (el) => {
                if(!el) return;
                let isDown = false;
                let startY, startX, scrollTop, scrollLeft;
                el.addEventListener('mousedown', (e) => {
                    const isInteractive = e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT' || e.target.closest('button') || e.target.closest('label') || e.target.closest('.drag-handle') || e.target.type === 'range';
                    if(isInteractive) return;
                    
                    isDown = true;
                    el.style.cursor = 'grabbing';
                    startX = e.pageX - el.offsetLeft;
                    startY = e.pageY - el.offsetTop;
                    scrollLeft = el.scrollLeft;
                    scrollTop = el.scrollTop;
                });
                el.addEventListener('mouseleave', () => { isDown = false; el.style.cursor = ''; });
                el.addEventListener('mouseup', () => { isDown = false; el.style.cursor = ''; });
                el.addEventListener('mousemove', (e) => {
                    if (!isDown) return;
                    e.preventDefault();
                    const x = e.pageX - el.offsetLeft;
                    const y = e.pageY - el.offsetTop;
                    el.scrollLeft = scrollLeft - (x - startX);
                    el.scrollTop = scrollTop - (y - startY);
                });
            };
            setTimeout(() => {
                if (!this.isViewerMode) attach(this.$refs.leftPanel);
                if (!this.isViewerMode) attach(this.$refs.rightPanel); 
            }, 100);
        },

        async initFirebase() {
            try {
                let firebaseConfig;
                try { firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null; } catch (e) {}

                if (!firebaseConfig) {
                    firebaseConfig = {
                        apiKey: "AIzaSyA_I1iwH0U26aaBavXqHL7fG32xvwDkF1o",
                        authDomain: "excel-ec5e4.firebaseapp.com",
                        projectId: "excel-ec5e4",
                        storageBucket: "excel-ec5e4.firebasestorage.app",
                        messagingSenderId: "427552489685",
                        appId: "1:427552489685:web:5c9a95aa347ddc4890225c",
                        measurementId: "G-TGR2BVMHD4"
                    };
                }

                const app = initializeApp(firebaseConfig);
                this.db = getFirestore(app);
                this.appId = typeof __app_id !== 'undefined' ? __app_id : 'excel-signature-board';

                const auth = getAuth(app);
                
                try {
                    if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                        await signInWithCustomToken(auth, __initial_auth_token);
                    } else {
                        await signInAnonymously(auth);
                    }
                } catch (err) {
                    try { 
                        await signInAnonymously(auth); 
                    } catch (err2) { 
                        console.error(err2); 
                    }
                }

                onAuthStateChanged(auth, (user) => {
                    if (user) {
                        this.userId = user.uid;
                        if(!this._unsubscribe) this.loadCloudData();
                    } else {
                        this.userId = null;
                        if(this._unsubscribe) { this._unsubscribe(); this._unsubscribe = null; }
                    }
                });
            } catch(e) {
                console.error("Firebase 초기화 오류:", e);
            }
        },

        loadCloudData() {
            if (!this.db || !this.userId) return; 
            
            const configDoc = doc(this.db, 'signature_boards', 'main_board_data');

            this._unsubscribe = onSnapshot(configDoc, (snapshot) => {
                if (snapshot.exists()) {
                    this.isSyncing = true;
                    const data = snapshot.data();
                    if(data.isDarkMode !== undefined) this.isDarkMode = data.isDarkMode;
                    if(data.groups) this.groups = data.groups;
                    if(data.members) this.members = data.members;
                    if(data.events) this.events = data.events;
                    
                    if(data.itemConfigs) {
                        let updatedItems = [...this.items];
                        
                        data.itemConfigs.forEach(conf => {
                            let idx = updatedItems.findIndex(i => i.id === conf.id);
                            if(idx !== -1) {
                                let isBroken = conf.isFrozen && (!conf.frozenDataUrl || conf.frozenDataUrl.length < 100);
                                
                                updatedItems[idx] = { 
                                    ...updatedItems[idx], 
                                    ...conf,
                                    isFrozen: isBroken ? false : conf.isFrozen,
                                    imgUrl: (conf.isFrozen && !isBroken) ? conf.frozenDataUrl : (conf.mediaUrl || this.getPlaceholderImage())
                                };
                            } else {
                                updatedItems.push({
                                    ...conf,
                                    imgUrl: (conf.isFrozen) ? conf.frozenDataUrl : (conf.mediaUrl || this.getPlaceholderImage())
                                });
                            }
                        });
                        updatedItems.sort((a, b) => a.id - b.id);
                        this.items = updatedItems;
                    }
                    this.reassignGroups();
                    setTimeout(() => { this.isSyncing = false; }, 100);
                }
            });
        },

        // 일반 보드 호출용 (정지된 가벼운 WebP 변환 반환)
        displayImageUrl(url) {
            if (!url) return '';
            if (url.startsWith('data:') || url.startsWith('blob:')) return url;
            return 'https://image-proxy.771excel.workers.dev/?url=' + encodeURIComponent(url);
        },

        compressDataUrl(dataUrl, quality = 0.6, maxWidth = 250) {
            return new Promise(resolve => {
                if(!dataUrl || !dataUrl.startsWith('data:image/')) return resolve(dataUrl);
                if(dataUrl.length < 20000) return resolve(dataUrl); 

                const img = new Image();
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;
                    
                    if(width > maxWidth) {
                        height = Math.round(height * (maxWidth / width));
                        width = maxWidth;
                    }
                    canvas.width = width;
                    canvas.height = height;
                    
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    
                    resolve(canvas.toDataURL('image/webp', quality));
                };
                img.onerror = () => resolve(dataUrl);
                img.src = dataUrl;
            });
        },

        async saveCloudData() {
            if (!this.db || !this.userId || this.isSyncing || this.isViewerMode) return;
            
            let needsCompression = false;
            for (let i of this.items) {
                if ((i.isFrozen && i.frozenDataUrl && i.frozenDataUrl.length > 30000) || 
                    (i.mediaUrl && i.mediaUrl.startsWith('data:image/') && i.mediaUrl.length > 30000)) {
                    needsCompression = true; break;
                }
            }

            if (needsCompression) {
                this.showToast("☁️ 데이터베이스 최적화 중... (화면이 잠시 멈출 수 있습니다)");
                for (let i of this.items) {
                    if (i.isFrozen && i.frozenDataUrl && i.frozenDataUrl.length > 30000) {
                        i.frozenDataUrl = await this.compressDataUrl(i.frozenDataUrl, 0.6, 250);
                        if (i.imgUrl && i.imgUrl.startsWith('data:image/') && i.imgUrl.length > 30000) i.imgUrl = i.frozenDataUrl;
                    }
                }
            }

            const configDoc = doc(this.db, 'signature_boards', 'main_board_data');
            
            const itemConfigs = this.items.map(i => ({
                id: i.id, name: i.name, isPersonal: i.isPersonal, isNew: i.isNew, memberId: i.memberId, groupId: i.groupId,
                isFrozen: i.isFrozen, frozenDataUrl: i.frozenDataUrl,
                audioUrl: i.audioUrl, mediaUrl: i.mediaUrl, hasAudio: i.hasAudio, hasImage: i.hasImage, isGif: i.isGif, originalGifUrl: i.originalGifUrl
            }));

            let payloadObj = {
                isDarkMode: this.isDarkMode,
                groups: this.groups,
                members: this.members,
                events: this.events,
                itemConfigs: itemConfigs
            };

            let payloadStr = JSON.stringify(payloadObj);

            if (new Blob([payloadStr]).size > 950000) {
                this.showToast("🚨 용량 한계 도달! 일부 무거운 캡처 이미지를 해제하여 안전하게 저장합니다.");
                
                let sortedConfigs = [...itemConfigs].sort((a, b) => (b.frozenDataUrl ? b.frozenDataUrl.length : 0) - (a.frozenDataUrl ? a.frozenDataUrl.length : 0));
                
                for (let conf of sortedConfigs) {
                    if (conf.frozenDataUrl && conf.frozenDataUrl.length > 1000) {
                        let target = itemConfigs.find(c => c.id === conf.id);
                        if (target) {
                            target.isFrozen = false;
                            target.frozenDataUrl = null;
                        }
                        payloadObj.itemConfigs = itemConfigs;
                        payloadStr = JSON.stringify(payloadObj);
                        if (new Blob([payloadStr]).size <= 950000) break; 
                    }
                }

                this.items.forEach(i => {
                    const conf = itemConfigs.find(c => c.id === i.id);
                    if (conf && !conf.isFrozen && i.isFrozen) {
                        i.isFrozen = false; i.frozenDataUrl = null;
                        if(i.originalGifUrl) i.imgUrl = i.originalGifUrl;
                    }
                });
            }

            try {
                await setDoc(configDoc, JSON.parse(payloadStr), {merge: true});
            } catch (e) {
                console.error(e);
                if (e.code === 'resource-exhausted' || e.message.includes('exceeds')) {
                    this.showToast("🚨 저장 실패: 파이어베이스 용량 초과(1MB).");
                } else if (e.code === 'permission-denied') {
                    this.showToast("🚨 저장 실패: 데이터베이스 쓰기 권한이 없습니다.");
                } else {
                    this.showToast("저장 실패: " + e.message); 
                }
                throw e;
            }
        },

        async exportSettings() {
            const data = {
                isDarkMode: this.isDarkMode, groups: this.groups, events: this.events, members: this.members,
                itemConfigs: this.items.map(i => ({
                    id: i.id, name: i.name, isPersonal: i.isPersonal, isNew: i.isNew, memberId: i.memberId, groupId: i.groupId,
                    isFrozen: i.isFrozen, frozenDataUrl: i.frozenDataUrl,
                    audioUrl: i.audioUrl, mediaUrl: i.mediaUrl, hasAudio: i.hasAudio, hasImage: i.hasImage, isGif: i.isGif, originalGifUrl: i.originalGifUrl
                }))
            };
            const jsonString = JSON.stringify(data, null, 2);
            const filename = `signature_settings_backup_${this.lastModified}.json`;

            try {
                if (window.showSaveFilePicker) {
                    const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'JSON Backup', accept: { 'application/json': ['.json'] } }] });
                    const writable = await handle.createWritable();
                    await writable.write(jsonString); await writable.close();
                    this.showToast("설정 백업이 저장되었습니다.");
                } else {
                    const blob = new Blob([jsonString], { type: 'application/json' });
                    this.triggerDownload(URL.createObjectURL(blob), filename);
                    this.showToast("백업 파일이 다운로드되었습니다.");
                }
            } catch (e) {}
        },

        async exportFrozenImagesZip() {
            const frozenItems = this.items.filter(i => i.isFrozen && i.frozenDataUrl);
            if (frozenItems.length === 0) { this.showToast("캡처된 썸네일이 없습니다."); return; }
            
            try {
                const zip = new JSZip();
                frozenItems.forEach(item => {
                    const base64Data = item.frozenDataUrl.split(',')[1];
                    zip.file(`${item.id}_${this.cleanName(item.name)}_캡처.png`, base64Data, {base64: true});
                });
                const content = await zip.generateAsync({type:"blob"});
                this.triggerDownload(URL.createObjectURL(content), `캡처_썸네일_일괄백업_${this.lastModified}.zip`);
                this.showToast("ZIP 백업이 완료되었습니다.");
            } catch(e) { this.showToast("ZIP 파일 생성 오류가 발생했습니다."); }
        },

        importSettings(e) {
            const file = e.target.files[0];
            if(!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => { 
                try {
                    const data = JSON.parse(event.target.result);
                    if(data.isDarkMode !== undefined) this.isDarkMode = data.isDarkMode;
                    if(data.groups) this.groups = data.groups;
                    if(data.events) this.events = data.events;
                    if(data.members) this.members = data.members;
                    
                    if(data.itemConfigs) {
                        let updatedItems = []; 
                        for (let conf of data.itemConfigs) {
                            if (conf.isFrozen && (!conf.frozenDataUrl || conf.frozenDataUrl.length < 100)) {
                                conf.isFrozen = false;
                            }
                            updatedItems.push({ ...conf, imgUrl: conf.isFrozen ? conf.frozenDataUrl : (conf.mediaUrl || this.getPlaceholderImage()) });
                        }
                        this.items = updatedItems;
                    }
                    this.reassignGroups();
                    
                    await this.saveCloudData();
                    this.showToast("✅ 설정 복구 및 저장이 완료되었습니다!");
                } catch(err) { 
                    this.showToast("파일 분석 또는 저장 오류 발생!"); 
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        },

        getPlaceholderImage() {
            const canvas = document.createElement('canvas');
            canvas.width = 400; canvas.height = 225;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#1f2937'; ctx.fillRect(0, 0, 400, 225);
            ctx.fillStyle = '#9ca3af'; ctx.font = 'bold 30px "Pretendard", sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('이미지 준비중', 200, 112);
            return canvas.toDataURL('image/png');
        },

        async handleFolderUpload(e) {
            const files = e.target.files;
            let tempMap = {}; 

            for (let file of files) {
                const match = file.name.match(/^(\d+)/);
                if (!match) continue;
                
                const numericId = parseInt(match[1], 10);
                if (!tempMap[numericId]) tempMap[numericId] = { id: numericId, imgUrl: '', audioName: file.name, hasAudio: false, hasImage: false, isGif: false }; 

                if (file.type.startsWith('image/')) {
                    tempMap[numericId].imgUrl = URL.createObjectURL(file);
                    tempMap[numericId].hasImage = true;
                    if (file.type === 'image/gif' || file.name.toLowerCase().endsWith('.gif')) tempMap[numericId].isGif = true;
                } else if (file.type.startsWith('audio/') || file.name.toLowerCase().match(/\.(mp3|wav|ogg|m4a)$/)) {
                    tempMap[numericId].audioName = file.name.replace(/\.[^/.]+$/, "");
                    tempMap[numericId].hasAudio = true;
                    tempMap[numericId].audioUrl = URL.createObjectURL(file); 
                }
            }

            for (const id in tempMap) {
                const existingItem = this.items.find(i => i.id === parseInt(id));
                const targetGroupId = this.findGroupForId(parseInt(id)); 

                if (existingItem) {
                    if (tempMap[id].imgUrl) {
                        if (existingItem.isFrozen && existingItem.frozenDataUrl) {
                            existingItem.originalGifUrl = tempMap[id].imgUrl;
                            existingItem.isGif = tempMap[id].isGif;
                        } else {
                            existingItem.imgUrl = tempMap[id].imgUrl;
                            existingItem.isGif = tempMap[id].isGif;
                            existingItem.isFrozen = false;
                            existingItem.frozenDataUrl = null;
                            existingItem.originalGifUrl = '';
                        }
                        existingItem.hasImage = true;
                    }
                    if (tempMap[id].hasAudio) {
                        existingItem.name = tempMap[id].audioName;
                        existingItem.audioUrl = tempMap[id].audioUrl; 
                        existingItem.hasAudio = true;
                    }
                    if (!existingItem.isPersonal && !existingItem.groupId) existingItem.groupId = targetGroupId;
                } else {
                    this.items.push({
                        id: parseInt(id),
                        name: tempMap[id].hasAudio ? tempMap[id].audioName : `${id}번 시그니처`,
                        imgUrl: tempMap[id].imgUrl || this.getPlaceholderImage(),
                        audioUrl: tempMap[id].audioUrl || '',
                        mediaUrl: '', hasAudio: tempMap[id].hasAudio, hasImage: tempMap[id].hasImage,
                        isGif: tempMap[id].isGif, isFrozen: false, originalGifUrl: '', frozenDataUrl: null,
                        isNew: false, isPersonal: false, memberId: '', groupId: targetGroupId
                    });
                }
            }
            this.items.sort((a, b) => a.id - b.id); e.target.value = '';
            
            await this.saveCloudData();
            this.showToast("✅ 폴더 파일이 안전하게 업로드 및 저장되었습니다.");
        },

        async importExcelLinks(e) {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, {type: 'array'});
                    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                    const json = XLSX.utils.sheet_to_json(worksheet, {header: 1});

                    let updatedCount = 0; let addedCount = 0;
                    
                    const findUrlInRow = (row) => {
                        if (!row) return "";
                        for (let j = 2; j < row.length; j++) {
                            const val = String(row[j] || "").trim();
                            if (val.startsWith("http://") || val.startsWith("https://")) return val;
                        }
                        return "";
                    };

                    for (let i = 2; i < json.length; i += 3) {
                        const row1 = json[i]; const row2 = json[i+1];
                        if (!row1 || row1.length === 0) continue;

                        const id = parseInt(row1[0], 10);
                        if (isNaN(id)) continue;

                        let url1 = findUrlInRow(row1); let url2 = findUrlInRow(row2);
                        let audioUrl = ""; let mediaUrl = "";

                        [url1, url2].filter(Boolean).forEach(url => {
                            if (/\.(mp3|wav|ogg|m4a)(\?.*)?$/i.test(url)) audioUrl = url;
                            else if (/\.(gif|png|jpg|jpeg|webp)(\?.*)?$/i.test(url)) mediaUrl = url;
                            else { if (!audioUrl) audioUrl = url; else if (!mediaUrl) mediaUrl = url; }
                        });

                        audioUrl = this.upgradeHttps(audioUrl);
                        mediaUrl = this.upgradeHttps(mediaUrl);

                        let isNewMark = row1[5] && String(row1[5]).trim() === "NEW"; // 컬럼 위치 수정 반영
                        let itemNameStr = String(row1[1] || `${id}번 시그니처`);
                        
                        let cleanName = itemNameStr.replace(/^\d+[_.\-\s]+/, '').trim() || `${id}번 시그니처`;

                        let item = this.items.find(x => x.id === id);
                        if (item) {
                            let changed = false;
                            if (audioUrl) { item.audioUrl = audioUrl; item.hasAudio = true; changed = true; }
                            if (mediaUrl) {
                                item.mediaUrl = mediaUrl; item.originalGifUrl = mediaUrl; 
                                if (!item.isFrozen || !item.frozenDataUrl) item.imgUrl = mediaUrl;
                                item.hasImage = true; item.isGif = mediaUrl.toLowerCase().includes('.gif'); changed = true;
                            }
                            if (isNewMark && !item.isNew) { item.isNew = true; changed = true; }
                            if (changed) updatedCount++;
                        } else {
                            this.items.push({
                                id: id, name: cleanName,
                                imgUrl: mediaUrl || this.getPlaceholderImage(), audioUrl: audioUrl || '', mediaUrl: mediaUrl || '',
                                hasAudio: !!audioUrl, hasImage: !!mediaUrl, isGif: mediaUrl ? mediaUrl.toLowerCase().includes('.gif') : false,
                                isFrozen: false, originalGifUrl: mediaUrl || '', frozenDataUrl: null,
                                isNew: isNewMark, isPersonal: false, memberId: '', groupId: this.findGroupForId(id)
                            });
                            addedCount++;
                        }
                    }
                    if (updatedCount > 0 || addedCount > 0) {
                        this.items.sort((a, b) => a.id - b.id); 
                        await this.saveCloudData(); 
                        this.showToast(`✅ 동기화 완료! (생성: ${addedCount} / 업데이트: ${updatedCount})`);
                    } else this.showToast("가져올 데이터가 없습니다.");
                } catch (err) { this.showToast("엑셀 파일 분석 오류가 발생했습니다."); }
                e.target.value = '';
            };
            reader.readAsArrayBuffer(file);
        },

        playAudio(item) {
            if(!item.audioUrl) return;
            const audio = document.getElementById('audio_player_' + item.id);
            if(audio) {
                if(audio.paused) { 
                    document.querySelectorAll('audio').forEach(a => a.pause()); 
                    audio.volume = this.globalVolume;
                    audio.play(); 
                } 
                else audio.pause();
            } else this.showToast("오디오 파일을 찾을 수 없습니다.");
        },

        findGroupForId(id) { const g = this.groups.find(g => g.start !== null && g.end !== null && id >= g.start && id <= g.end); return g ? g.id : 'g_default'; },
        reassignGroups() { this.items.forEach(item => { if (!item.isPersonal) item.groupId = this.findGroupForId(item.id); }); },
        reorderGroups(oldIndex, newIndex) { const moved = this.groups.splice(oldIndex, 1)[0]; this.groups.splice(newIndex, 0, moved); this.saveCloudData(); },
        
        addGroup() {
            if(!this.newGroupName.trim()) return;
            this.groups.push({ id: 'g_' + Date.now(), name: this.newGroupName.trim(), start: parseInt(this.newGroupStart) || null, end: parseInt(this.newGroupEnd) || null, color: this.newGroupColor });
            this.reassignGroups(); this.newGroupName = ''; this.newGroupStart = ''; this.newGroupEnd = ''; this.newGroupColor = '#3B82F6'; this.saveCloudData();
        },
        startEditGroup(group) { this.editingGroupId = group.id; this.editGroupData = { name: group.name, start: group.start || '', end: group.end || '', color: group.color || '#3B82F6' }; },
        saveEditGroup(id) {
            const group = this.groups.find(g => g.id === id);
            if(group) { group.name = this.editGroupData.name; group.start = parseInt(this.editGroupData.start) || null; group.end = parseInt(this.editGroupData.end) || null; group.color = this.editGroupData.color; this.reassignGroups(); }
            this.editingGroupId = null; this.saveCloudData();
        },
        cancelEditGroup() { this.editingGroupId = null; },
        removeGroup(id) { if(this.groups.length <= 1) return; this.groups = this.groups.filter(g => g.id !== id); this.reassignGroups(); this.saveCloudData(); },
        
        addMember() { if(!this.newMemberName.trim()) return; this.members.push({ id: 'm_' + Date.now(), name: this.newMemberName.trim() }); this.newMemberName = ''; this.saveCloudData(); },
        reorderMembers(oldIndex, newIndex) { const moved = this.members.splice(oldIndex, 1)[0]; this.members.splice(newIndex, 0, moved); this.saveCloudData(); },
        
        removeMember(id) { 
            const member = this.members.find(m => m.id === id);
            const associatedItems = this.items.filter(i => i.memberId === id);
            
            if (associatedItems.length > 0) {
                const itemIds = associatedItems.map(i => i.id).join(', ');
                const confirmMsg = `[ ${member.name} ] 멤버를 삭제하시겠습니까?\n이 멤버에 지정된 시그니처 단가 [ ${itemIds} ] 도 함께 삭제됩니다.\n\n삭제를 진행하시려면 '확인'을 눌러주세요.`;
                if (!confirm(confirmMsg)) return;
                
                this.items = this.items.filter(i => i.memberId !== id);
            } else {
                if (!confirm(`[ ${member.name} ] 멤버를 삭제하시겠습니까?`)) return;
            }

            this.members = this.members.filter(m => m.id !== id);
            this.saveCloudData(); 
        },
        
        addEvent() { 
            if(!this.newEventTitle.trim()) return; 
            this.events.push({ id: 'e_' + Date.now(), title: this.newEventTitle.trim(), targets: this.newEventTargets.trim(), color: this.newEventColor }); 
            this.newEventTitle = ''; this.newEventTargets = ''; this.newEventColor = '#F59E0B'; this.saveCloudData(); 
        },
        startEditEvent(event) {
            this.editingEventId = event.id;
            this.editEventData = { title: event.title, targets: event.targets, color: event.color || '#F59E0B' };
        },
        saveEditEvent(id) {
            const e = this.events.find(x => x.id === id);
            if(e) {
                e.title = this.editEventData.title;
                e.targets = this.editEventData.targets;
                e.color = this.editEventData.color;
            }
            this.editingEventId = null;
            this.saveCloudData();
        },
        cancelEditEvent() { this.editingEventId = null; },
        removeEvent(id) { this.events = this.events.filter(e => e.id !== id); this.saveCloudData(); },

        getItemsByGroup(groupId) { return this.items.filter(i => i.groupId === groupId && !i.isPersonal); },
        getEventItems(targetsString) {
            if(!targetsString) return [];
            const ids = targetsString.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
            return this.items.filter(i => ids.includes(i.id));
        },
        getPersonalItemsByMember(memberId) { return this.items.filter(i => i.isPersonal && i.memberId === memberId); },
        getUnassignedPersonalItems() { return this.items.filter(i => i.isPersonal && !i.memberId); },
        get newItems() { return this.items.filter(i => i.isNew); },

        get filteredItems() {
            let result = this.items;
            if (this.detailFilter !== 'all') {
                if (this.detailFilter.startsWith('g_')) result = result.filter(i => !i.isPersonal && i.groupId === this.detailFilter.replace('g_', ''));
                else if (this.detailFilter.startsWith('m_')) {
                    const mid = this.detailFilter.replace('m_', '');
                    result = mid === 'unassigned' ? result.filter(i => i.isPersonal && !i.memberId) : result.filter(i => i.isPersonal && i.memberId === mid);
                }
                else if (this.detailFilter === 'new') result = result.filter(i => i.isNew);
            }
            if (this.searchQuery.trim()) {
                const query = this.searchQuery.toLowerCase();
                result = result.filter(item => item.name.toLowerCase().includes(query) || item.id.toString().includes(query));
            }
            return result;
        },

        // 완전 새로 설계된 라이브 스냅샷 스튜디오 로직
        async openGifModal(item) {
            this.modalItem = item; 
            this.modalOpen = true; 
            this.isGifLoading = true; 
            
            const previewImg = document.getElementById('modal_img_preview');
            if(previewImg) {
                previewImg.src = '';
                previewImg.crossOrigin = "anonymous";
            }
            
            let originalUrl = this.modalItem.originalGifUrl || this.modalItem.imgUrl;
            
            // 프록시 서버에 anim=true를 보내서 애니메이션 WebP를 즉시 받아옵니다.
            let animProxyUrl = `https://image-proxy.771excel.workers.dev/?anim=true&url=${encodeURIComponent(originalUrl)}`;
            
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                this.isGifLoading = false;
                if(previewImg) previewImg.src = animProxyUrl;
            };
            img.onerror = () => {
                this.isGifLoading = false;
                this.showToast("🚨 애니메이션 로드에 실패했습니다. (원본 파일 삭제/손상)");
            };
            img.src = animProxyUrl;
        },
        
        closeGifModal() {
            this.modalOpen = false; 
            this.modalItem = null;
            const previewImg = document.getElementById('modal_img_preview');
            if(previewImg) previewImg.src = '';
        },
        
        async captureModalFrame() {
            if (!this.modalItem) return;
            
            const imgElement = document.getElementById('modal_img_preview');
            
            // 이미지 태그에서 현재 눈에 보이는 애니메이션 프레임을 그대로 캔버스에 그립니다. (JS 연산 0)
            if(!imgElement || !imgElement.complete || imgElement.naturalWidth === 0) {
                this.showToast("🚨 이미지가 덜 불러와졌습니다. 잠시만 기다려주세요.");
                return;
            }

            const sourceCanvas = document.createElement('canvas'); 
            sourceCanvas.width = imgElement.naturalWidth; 
            sourceCanvas.height = imgElement.naturalHeight;
            const ctx = sourceCanvas.getContext('2d'); 
            ctx.drawImage(imgElement, 0, 0, sourceCanvas.width, sourceCanvas.height);

            const MAX_W = 350; 
            let width = sourceCanvas.width; 
            let height = sourceCanvas.height; 
            if(width > MAX_W) { 
                height = Math.round(height * (MAX_W / width)); 
                width = MAX_W; 
            }
            
            const outCanvas = document.createElement('canvas');
            outCanvas.width = width; 
            outCanvas.height = height;
            outCanvas.getContext('2d').drawImage(sourceCanvas, 0, 0, width, height);
            
            if (!this.modalItem.originalGifUrl) this.modalItem.originalGifUrl = this.modalItem.imgUrl;
            
            try {
                const dataUrl = outCanvas.toDataURL('image/webp', 0.7); 
                
                const targetIdx = this.items.findIndex(i => i.id === this.modalItem.id);
                if (targetIdx !== -1) {
                    this.items[targetIdx].imgUrl = dataUrl;
                    this.items[targetIdx].frozenDataUrl = dataUrl;
                    this.items[targetIdx].isFrozen = true;
                    this.items[targetIdx].originalGifUrl = this.modalItem.originalGifUrl;
                }
                
                this.modalItem.imgUrl = dataUrl; 
                this.modalItem.frozenDataUrl = dataUrl; 
                this.modalItem.isFrozen = true;
                
                this.showToast("✅ 완벽하게 캡처 및 고정되었습니다!");
                await this.saveCloudData();
            } catch (err) {
                this.showToast("🚨 알 수 없는 오류로 캡처를 실패했습니다.");
            }
        },
        
        async resetModalFrame() {
            if (!this.modalItem) return;
            this.isGifLoading = true;

            if (this.modalItem.originalGifUrl) {
                this.modalItem.imgUrl = this.modalItem.originalGifUrl;
                const targetIdx = this.items.findIndex(i => i.id === this.modalItem.id);
                if (targetIdx !== -1) {
                    this.items[targetIdx].imgUrl = this.modalItem.originalGifUrl;
                    this.items[targetIdx].isFrozen = false;
                    this.items[targetIdx].frozenDataUrl = null;
                }
            }
            this.modalItem.isFrozen = false; 
            this.modalItem.frozenDataUrl = null;
            
            let originalUrl = this.modalItem.originalGifUrl || this.modalItem.imgUrl;
            let animProxyUrl = `https://image-proxy.771excel.workers.dev/?anim=true&url=${encodeURIComponent(originalUrl)}`;
            
            const previewImg = document.getElementById('modal_img_preview');
            if(previewImg) previewImg.src = '';
            
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                this.isGifLoading = false;
                if(previewImg) previewImg.src = animProxyUrl;
            };
            img.src = animProxyUrl;
            await this.saveCloudData();
        },
        
        downloadCurrentModalFrame() {
            if(!this.modalItem || !this.modalItem.frozenDataUrl) return;
            this.triggerDownload(this.modalItem.frozenDataUrl, `${this.modalItem.id}_${this.cleanName(this.modalItem.name)}_캡처.png`);
        },

        cleanName(name) { return name.replace(/^\d+[_.\-\s]+/, ''); },

        copyViewerLink() {
            const url = window.location.origin + window.location.pathname + '?viewer=true';
            const iframeCode = `<iframe src="${url}" style="border:none; border-radius:12px; overflow:hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.1); width: 100%; min-height: 1200px; max-width: 100%;" allowfullscreen></iframe>`;
            const textArea = document.createElement("textarea"); textArea.value = iframeCode; textArea.style.position = "fixed";
            document.body.appendChild(textArea); textArea.focus(); textArea.select();
            try { document.execCommand('copy'); this.showToast('뷰어 태그가 복사되었습니다!'); } catch (err) { this.showToast('복사에 실패했습니다.'); }
            document.body.removeChild(textArea);
        },

        async exportExcel(includeData = false) {
            if(this.items.length === 0) { this.showToast("출력할 목록이 없습니다."); return; }
            const data = []; const merges = [];
            
            data.push(["771 시그니처 외부링크 목록", "", "", "", "", ""]); 
            merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }); 
            data.push(["번호", "시그니처 이름", "이미지 외부링크", "음원 외부링크", "비고 (개인)", "NEW 표기"]); 

            let currentRow = 2; 
            this.items.forEach(item => {
                let remarks = [];
                if (item.isPersonal) {
                    const member = this.members.find(m => m.id === item.memberId);
                    remarks.push(member ? `개인 (${member.name})` : "개인");
                }
                const newMark = item.isNew ? "NEW" : "";
                
                const audioStr = includeData && item.audioUrl ? item.audioUrl : "";
                const mediaStr = includeData && item.mediaUrl ? item.mediaUrl : "";

                data.push([
                    item.id, 
                    `${item.id} ${this.cleanName(item.name)}`, 
                    mediaStr, 
                    audioStr, 
                    remarks.join(", "), 
                    newMark
                ]);
                currentRow++;
            });

            const wb = XLSX.utils.book_new(); const ws = XLSX.utils.aoa_to_sheet(data);
            ws['!merges'] = merges; 
            ws['!cols'] = [{ wch: 8 }, { wch: 35 }, { wch: 60 }, { wch: 60 }, { wch: 20 }, { wch: 15 }];
            
            ws['!autofilter'] = { ref: `A2:F${currentRow - 1}` };

            for (let cellAddress in ws) {
                if (cellAddress[0] === '!') continue;
                const col = cellAddress.replace(/[0-9]/g, ''); const row = parseInt(cellAddress.replace(/\D/g, '')) - 1; 
                if (!ws[cellAddress].s) ws[cellAddress].s = {};
                ws[cellAddress].s.font = { name: "맑은 고딕", sz: 11 };
                
                ws[cellAddress].s.alignment = { vertical: "center" };
                if (['A', 'E', 'F'].includes(col)) ws[cellAddress].s.alignment.horizontal = "center";
                
                if (row === 0) { ws[cellAddress].s.alignment = { horizontal: "center", vertical: "center" }; ws[cellAddress].s.font = { name: "맑은 고딕", sz: 14, bold: true }; }
                if (row === 1) { ws[cellAddress].s.alignment = { horizontal: "center", vertical: "center" }; ws[cellAddress].s.font = { name: "맑은 고딕", sz: 11, bold: true }; ws[cellAddress].s.fill = { fgColor: { rgb: "F3F4F6" } }; }
                
                if (col === 'F' && row > 1) { ws[cellAddress].s.font = { name: "맑은 고딕", sz: 11, color: { rgb: "FF0000" }, bold: true }; }
            }
            XLSX.utils.book_append_sheet(wb, ws, "시그니처 목록");
            const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
            const blob = new Blob([wbout], { type: 'application/octet-stream' });
            
            const filename = includeData ? `시그니처목록_현재데이터백업_${this.lastModified}.xlsx` : `시그니처목록_업로드빈양식_${this.lastModified}.xlsx`;
            
            try {
                if (window.showSaveFilePicker) {
                    const handle = await window.showSaveFilePicker({ suggestedName: filename, types: [{ description: 'Excel File', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] } }] });
                    const writable = await handle.createWritable();
                    await writable.write(blob); await writable.close(); this.showToast("저장 완료");
                } else XLSX.writeFile(wb, filename); 
            } catch (e) { if (e.name !== 'AbortError') XLSX.writeFile(wb, filename); }
        },

        async downloadImage() {
            if (this.items.length === 0) { this.showToast("다운로드할 내용이 없습니다."); return; }
            this.isDownloading = true;

            let dirHandle = null;
            if (window.showDirectoryPicker) {
                try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (e) { if (e.name !== 'AbortError') this.isDownloading = false; return; }
            }

            const board = this.$refs.captureBoard;
            try {
                const scale = 2.5; const bgColor = this.isDarkMode ? '#111827' : '#f9fafb';
                const canvas = await html2canvas(board, { scale: scale, useCORS: true, backgroundColor: bgColor });
                
                const items = board.querySelectorAll('.avoid-break');
                const ranges = Array.from(items).map(el => {
                    const rect = el.getBoundingClientRect(); const boardRect = board.getBoundingClientRect();
                    return { top: (rect.top - boardRect.top) * scale, bottom: (rect.bottom - boardRect.top) * scale };
                });

                const MAX_HEIGHT = 8000; 

                const saveCanvasPart = async (partCanvas, filename) => {
                    return new Promise(resolve => {
                        partCanvas.toBlob(async (blob) => {
                            if (dirHandle) {
                                try {
                                    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
                                    const writable = await fileHandle.createWritable();
                                    await writable.write(blob); await writable.close();
                                } catch (e) { this.triggerDownload(URL.createObjectURL(blob), filename); }
                            } else this.triggerDownload(URL.createObjectURL(blob), filename);
                            resolve();
                        }, 'image/png'); 
                    });
                };

                if (canvas.height <= MAX_HEIGHT) {
                    await saveCanvasPart(canvas, `시그니처보드_${this.lastModified}.png`);
                    this.showToast(dirHandle ? "폴더에 저장되었습니다." : "다운로드 되었습니다.");
                } else {
                    let currentY = 0; let partNum = 1;
                    while (currentY < canvas.height) {
                        let nextY = currentY + MAX_HEIGHT;
                        if (nextY < canvas.height) {
                            let intersectingItem = ranges.find(r => nextY > r.top && nextY < r.bottom);
                            if (intersectingItem) {
                                nextY = intersectingItem.top - (20 * scale);
                                if (nextY <= currentY) nextY = intersectingItem.bottom + (20 * scale);
                            }
                        } else nextY = canvas.height;

                        const partHeight = nextY - currentY;
                        const partCanvas = document.createElement('canvas');
                        partCanvas.width = canvas.width; partCanvas.height = partHeight;
                        partCanvas.getContext('2d').drawImage(canvas, 0, currentY, canvas.width, partHeight, 0, 0, canvas.width, partHeight);
                        
                        await saveCanvasPart(partCanvas, `시그니처보드_${this.lastModified}_part${partNum}.png`);
                        currentY = nextY; partNum++;
                    }
                    this.showToast(`${partNum - 1}장으로 고화질 PNG 분할 저장되었습니다.`);
                }
            } catch(e) { this.showToast('이미지 생성 오류'); } finally { this.isDownloading = false; }
        },

        triggerDownload(dataUrl, filename) {
            const link = document.createElement('a'); link.download = filename; link.href = dataUrl;
            document.body.appendChild(link); link.click(); document.body.removeChild(link);
        }
    }));
});
