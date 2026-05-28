// --- State Management ---
let userProfile = JSON.parse(localStorage.getItem('sa_user_profile')) || null;
let jobState = JSON.parse(localStorage.getItem('sa_job_state')) || {}; // { jobKey: { ...jobDetails } }
let activeDay = localStorage.getItem('sa_active_day') || '';
// --- DOM Elements ---
const elTime = document.getElementById('current-time');
const elSyncIndicator = document.getElementById('sync-indicator');
const elLastSync = document.getElementById('last-sync-time');
const elCountdown = document.getElementById('countdown-timer');
const elJobsList = document.getElementById('jobs-list');

const kpiTotal = document.getElementById('kpi-total');
const kpiPersonal = document.getElementById('kpi-personal');
const kpiFleet = document.getElementById('kpi-fleet');
const kpiNotif = document.getElementById('kpi-notifications');
const badgeNotif = document.getElementById('notification-badge');

let notificationsCount = 0;
let refreshCountdown = 30;
const REFRESH_INTERVAL = 30;

// --- Utility Functions ---

// Get current date string in Asia/Bangkok time
function getThaiDateInfo() {
    const now = new Date();
    // Using Intl.DateTimeFormat to reliably extract day in Bangkok time
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
    }).formatToParts(now);
    
    const info = {};
    parts.forEach(p => info[p.type] = p.value);
    
    const thaiDate = new Intl.DateTimeFormat('th-TH', {
        timeZone: 'Asia/Bangkok',
        day: 'numeric',
        month: 'short',
        year: 'numeric'
    }).format(now);
    
    return {
        dayStr: info.day, // e.g. "28"
        timeStr: `${info.hour}:${info.minute}:${info.second.padStart(2, '0')}`,
        dateStr: thaiDate,
        rawDate: now
    };
}

// Clock updates
setInterval(() => {
    elTime.textContent = getThaiDateInfo().dateStr;
}, 1000);

// Phone Formatter
function formatPhone(phoneStr) {
    if (!phoneStr) return '-';
    let clean = String(phoneStr).replace(/[^\d+]/g, '');
    if (clean.startsWith('+66')) clean = '0' + clean.slice(3);
    else if (clean.startsWith('66')) clean = '0' + clean.slice(2);
    else if (clean.length === 9 && !clean.startsWith('0')) clean = '0' + clean;
    
    if (clean.length === 10 && clean.startsWith('0')) {
        return `${clean.slice(0,3)}-${clean.slice(3,6)}-${clean.slice(6)}`;
    }
    return clean;
}

// Map Link Generator
function generateMapLink(addressStr) {
    if (!addressStr) return null;
    const urlMatch = String(addressStr).match(/https?:\/\/[^\s]+/);
    if (urlMatch) return urlMatch[0];
    return `http://maps.google.com/?q=${encodeURIComponent(addressStr)}`;
}

// Play Audio
function playChime() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
        osc.frequency.exponentialRampToValueAtTime(1046.50, ctx.currentTime + 0.1); // C6
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 1);
    } catch (e) {
        console.warn('Audio play failed', e);
    }
}

// Show Toast
function showToast(title, message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast border-${type}`;
    
    let icon = 'fa-info-circle';
    let color = 'var(--emerald-600)';
    if(type === 'success') { icon = 'fa-check-circle'; color = 'var(--success)'; }
    if(type === 'warning') { icon = 'fa-exclamation-triangle'; color = 'var(--warning)'; }
    if(type === 'danger') { icon = 'fa-circle-xmark'; color = 'var(--danger)'; }
    if(type === 'new') { icon = 'fa-star'; color = 'var(--violet-500)'; }

    toast.innerHTML = `
        <div class="toast-icon" style="color: ${color}"><i class="fa-solid ${icon}"></i></div>
        <div class="toast-content">
            <h4 style="color: ${color}">${title}</h4>
            <p>${message}</p>
        </div>
    `;
    
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 5000);

    addHistoryLog(title, message, color);
    
    notificationsCount++;
    kpiNotif.textContent = notificationsCount;
    badgeNotif.textContent = notificationsCount;
    badgeNotif.style.display = 'block';
    
    playChime();
    
    if (Notification.permission === 'granted') {
        new Notification(title, { body: message });
    }
}

function addHistoryLog(title, message, color) {
    const history = document.getElementById('notification-history');
    if(history.querySelector('.empty-state')) {
        history.innerHTML = '';
    }
    const item = document.createElement('div');
    item.className = 'history-item';
    item.style.borderLeftColor = color;
    item.innerHTML = `
        <div class="history-time">${getThaiDateInfo().timeStr}</div>
        <div style="font-weight: 500; color: ${color}; margin-bottom: 4px;">${title}</div>
        <div style="color: var(--slate-500); font-size: 0.85rem;">${message}</div>
    `;
    history.prepend(item);
}

// --- Data Fetching & Processing ---

async function fetchJobs() {
    elSyncIndicator.className = 'status-dot syncing';
    try {
        const { dayStr } = getThaiDateInfo();
        
        // Handle Day Rollover / Morning Summary
        if (activeDay !== dayStr) {
            console.log("New day detected! Resetting state...");
            if (activeDay !== '') {
                // Not first load, a real rollover
                setTimeout(() => showMorningSummary(), 2000);
            }
            activeDay = dayStr;
            localStorage.setItem('sa_active_day', activeDay);
            jobState = {};
            localStorage.setItem('sa_job_state', JSON.stringify(jobState));
        }

        const response = await fetch(`/api/jobs?day=${dayStr}`);
        if (!response.ok) throw new Error('API failed');
        const data = await response.json();
        
        processGoogleSheetData(data.table.rows);
        
        elSyncIndicator.className = 'status-dot';
        elLastSync.textContent = `อัปเดตล่าสุด: ${getThaiDateInfo().timeStr}`;
    } catch (err) {
        console.error(err);
        elSyncIndicator.className = 'status-dot error';
    }
}

function processGoogleSheetData(rows) {
    let parsedJobs = [];
    
    rows.forEach(row => {
        if (!row || !row.c) return;
        
        // Bulletproof cell extraction
        const cells = row.c.map(cell => {
            if (!cell) return '';
            if (cell.f !== undefined && cell.f !== null) return String(cell.f);
            if (cell.v !== undefined && cell.v !== null) {
                const vStr = String(cell.v);
                if (vStr.startsWith('Date(')) {
                    const m = vStr.match(/Date\(.*?,.*?,.*?,(\d+),(\d+),(\d+)\)/);
                    if (m) return `${m[1].padStart(2,'0')}:${m[2].padStart(2,'0')}`;
                }
                return vStr;
            }
            return '';
        });
        
        const driver = String(cells[3] || '').trim();
        if (!driver) return; // Skip empty rows
        
        // Extract Arrival Time
        const arrivalTime = String(cells[7] || '').trim();

        // Category Detection
        let category = 'OTHER';
        const rawRowText = cells.join('').replace(/\s+/g, '').toUpperCase();
        if (rawRowText.includes('ONLINE')) category = 'ONLINE';
        else if (rawRowText.includes('OFFLINE')) category = 'OFFLINE';
        else if (rawRowText.includes('JIRAB2B')) category = 'JIRAB2B';
        else if (rawRowText.includes('JIRAB2C')) category = 'JIRAB2C';

        const round = String(cells[4] || '').trim();
        const fleet = String(cells[5] || '').trim();
        const model = String(cells[8] || '').trim();
        const plate = String(cells[9] || '').trim();
        const detail = String(cells[10] || '').trim();
        const action = String(cells[11] || '').trim();
        const timeBF = String(cells[13] || '').trim();
        const customer = String(cells[14] || '').trim();
        const phone = formatPhone(cells[15]);
        const addrSrc = String(cells[16] || '').trim();
        const addrDst = String(cells[17] || '').trim();
        const parking = String(cells[21] || '').trim();

        // Address Routing
        let displayAddress = addrDst || addrSrc || '-';
        if (action.includes('รับกลับจากศูนย์')) {
            displayAddress = addrSrc || addrDst || '-';
        } else if (action.includes('ส่งเข้าซ่อม') || action.includes('ส่งเช็คระยะ') || action.includes('สลับ') || action.includes('รถทดแทน')) {
            displayAddress = addrDst || addrSrc || '-';
        }

        const mapLink = generateMapLink(displayAddress);

        // Compute Unique Job Key
        const jobKey = `${driver}${round}${fleet}${plate}`.replace(/\s+/g, '');
        if(!jobKey) return;

        parsedJobs.push({
            jobKey, driver, round, fleet, model, plate, detail, action, timeBF, arrivalTime,
            customer, phone, displayAddress, mapLink, parking, category,
            isPersonal: !fleet
        });
    });

    // Chronological Sort (Time ascending, NOFIX at the bottom)
    parsedJobs.sort((a, b) => {
        const isNoFixA = !a.timeBF || a.timeBF.toUpperCase().includes('NOFIX') || a.timeBF.toUpperCase().includes('NO FIXED');
        const isNoFixB = !b.timeBF || b.timeBF.toUpperCase().includes('NOFIX') || b.timeBF.toUpperCase().includes('NO FIXED');
        
        if (isNoFixA && !isNoFixB) return 1;
        if (!isNoFixA && isNoFixB) return -1;
        if (isNoFixA && isNoFixB) return 0;
        
        // If both have valid times, sort them chronologically
        const timeA = a.timeBF || '23:59';
        const timeB = b.timeBF || '23:59';
        return timeA.localeCompare(timeB);
    });

    let myJobs = [];
    if (userProfile && userProfile.realName) {
        const uName = userProfile.realName.toUpperCase();
        const uNick = userProfile.nickname ? userProfile.nickname.toUpperCase() : '';
        
        myJobs = parsedJobs.filter(j => {
            const driverStr = j.driver.toUpperCase();
            const fleetStr = j.fleet.toUpperCase();
            
            // 1. ถ้าชื่อจริง (uName) ตรงกับช่องคนขับ หรือ ช่อง Fleet -> ถือว่าเป็นงานของเราแน่นอน
            if (driverStr.includes(uName) || fleetStr.includes(uName)) {
                return true;
            }
            
            // 2. ถ้าชื่อจริงไม่ตรง ลองเช็คจากชื่อเล่น (uNick)
            if (uNick) {
                // งาน Fleet ส่วนใหญ่ใส่แค่ชื่อเล่น ถ้าตรงถือว่าเป็นงานเรา
                if (fleetStr.includes(uNick)) {
                    return true;
                }
                
                // สำหรับช่องคนขับ (Driver) ต้องระวังคนชื่อเล่นซ้ำกัน
                if (driverStr.includes(uNick)) {
                    // ถ้ารูปแบบเป็น "ชื่อจริง(ชื่อเล่น)" หรือ "ชื่อจริง (ชื่อเล่น)"
                    if (driverStr.includes('(')) {
                        const namePart = driverStr.split('(')[0].trim();
                        // ถ้ามีส่วนของชื่อจริงอยู่ และมันไม่ตรงกับชื่อจริงของเราเลย -> แสดงว่าเป็นของคนอื่นที่ชื่อเล่นซ้ำกัน! (ให้ข้ามไป)
                        if (namePart.length > 0 && !namePart.includes(uName) && !uName.includes(namePart)) {
                            return false; 
                        }
                    }
                    // ถ้าแอดมินพิมพ์มาแค่ "บอย" ไม่มีชื่อจริงกำกับ ก็อนุโลมให้เห็นได้
                    return true;
                }
            }
            
            return false;
        });
    }
    handleStateChanges(myJobs);
    renderJobs(myJobs);
    updateKPIs(myJobs);
}

function handleStateChanges(currentJobs) {
    let newState = {};
    const currentKeys = new Set(currentJobs.map(j => j.jobKey));
    
    // Check for Removed or Reassigned Jobs
    for (const oldKey in jobState) {
        if (!currentKeys.has(oldKey)) {
            const oldJob = jobState[oldKey];
            // Only alert if we already had a stable state loaded
            if (Object.keys(jobState).length > 0) {
                showToast('งานถูกยกเลิก / เปลี่ยนคนขับ', `เวลา ${oldJob.timeBF} (ทะเบียน ${oldJob.plate}) ถูกดึงออกจากคิวของคุณ`, 'danger');
            }
        }
    }
    
    currentJobs.forEach(job => {
        newState[job.jobKey] = job;
        
        if (!jobState[job.jobKey]) {
            // New Job
            if(Object.keys(jobState).length > 0) { // Don't notify on initial load
                showToast('งานใหม่ถูกเพิ่ม', `เวลา ${job.timeBF} ทะเบียน ${job.plate}`, 'new');
                job.isNew = true;
            }
        } else {
            // Compare
            const old = jobState[job.jobKey];
            let changes = [];
            if (old.timeBF !== job.timeBF) changes.push(`เวลา: ${old.timeBF} -> ${job.timeBF}`);
            if (old.action !== job.action) changes.push(`สถานะ: ${old.action} -> ${job.action}`);
            
            if (changes.length > 0) {
                showToast('อัปเดตงาน', `ทะเบียน ${job.plate}\n${changes.join(', ')}`, 'warning');
                job.isUpdated = true;
            }
        }
    });

    jobState = newState;
    localStorage.setItem('sa_job_state', JSON.stringify(jobState));
}

// --- Renderers ---

function getActionColor(action) {
    if (action.includes('รับกลับ')) return 'var(--success)';
    if (action.includes('ซ่อม') || action.includes('อุบัติเหตุ')) return 'var(--danger)';
    if (action.includes('สลับ') || action.includes('เช็คระยะ')) return 'var(--warning)';
    return 'var(--emerald-600)';
}

function getCategoryColor(cat) {
    switch(cat) {
        case 'ONLINE': return '#10b981';
        case 'OFFLINE': return '#f59e0b';
        case 'JIRAB2B': return '#3b82f6';
        case 'JIRAB2C': return '#8b5cf6';
        default: return '#64748b';
    }
}

function getBrandLogo(modelStr) {
    if (!modelStr) return '<i class="fa-solid fa-car-side"></i>';
    const m = modelStr.toUpperCase();
    
    // Google Favicons API — hosted by Google, 100% reliable, never blocked
    const brands = [
        { keys: ['BYD'], domain: 'byd.com', label: 'BYD', bg: '#1a1a2e', color: '#fff' },
        { keys: ['MG'], domain: '', label: 'MG', bg: '#c41230', color: '#fff' },
        { keys: ['TESLA'], domain: 'tesla.com', label: 'T', bg: '#cc0000', color: '#fff' },
        { keys: ['TOYOTA'], domain: 'toyota.com', label: 'T', bg: '#eb0a1e', color: '#fff' },
        { keys: ['HONDA'], domain: 'honda.co.th', label: 'H', bg: '#cc0000', color: '#fff' },
        { keys: ['BMW'], domain: 'bmw.com', label: 'BMW', bg: '#0066b1', color: '#fff' },
        { keys: ['BENZ', 'MERCEDES'], domain: 'mercedes-benz.com', label: 'MB', bg: '#222', color: '#c0c0c0' },
        { keys: ['PORSCHE'], domain: 'porsche.com', label: 'P', bg: '#000', color: '#d5a500' },
        { keys: ['VOLVO'], domain: 'volvocars.com', label: 'V', bg: '#003057', color: '#fff' },
        { keys: ['GWM', 'ORA', 'HAVAL'], domain: '', label: 'GWM', bg: '#0b3d91', color: '#fff' },
        { keys: ['NETA'], domain: '', label: 'N', bg: '#00aaff', color: '#fff' },
        { keys: ['CHANGAN', 'DEEPAL'], domain: '', label: 'CA', bg: '#003399', color: '#fff' },
        { keys: ['AION'], domain: '', label: 'Ai', bg: '#6c3baa', color: '#fff' },
        { keys: ['KIA'], domain: '', label: 'KIA', bg: '#05141f', color: '#fff' },
        { keys: ['HYUNDAI'], domain: 'hyundai.com', label: 'H', bg: '#002c5f', color: '#fff' },
        { keys: ['NISSAN'], domain: 'nissan.co.th', label: 'N', bg: '#c3002f', color: '#fff' },
        { keys: ['MAZDA'], domain: 'mazda.co.th', label: 'M', bg: '#101010', color: '#910a2a' },
        { keys: ['ISUZU'], domain: '', label: 'ISZ', bg: '#c41230', color: '#fff' },
        { keys: ['MITSUBISHI'], domain: '', label: '◆', bg: '#e60012', color: '#fff' },
        { keys: ['FORD'], domain: 'ford.co.th', label: 'F', bg: '#003478', color: '#fff' },
        { keys: ['SUZUKI'], domain: '', label: 'S', bg: '#003399', color: '#fff' },
        { keys: ['MINI'], domain: 'mini.com', label: 'MINI', bg: '#000', color: '#c0c0c0' },
    ];
    
    for (const b of brands) {
        if (b.keys.some(k => m.includes(k))) {
            const textBadge = `<span style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:${b.bg};color:${b.color};font-family:Inter,sans-serif;font-weight:900;font-size:${b.label.length > 2 ? '0.7rem' : '1.2rem'};letter-spacing:${b.label.length > 2 ? '1px' : '0'};border-radius:10px">${b.label}</span>`;
            if (!b.domain) return textBadge;

            const fallback = `this.onerror=null;this.style.display='none';this.parentElement.innerHTML='<span style=&quot;display:flex;align-items:center;justify-content:center;width:100%;height:100%;background:${b.bg};color:${b.color};font-family:Inter,sans-serif;font-weight:900;font-size:${b.label.length > 2 ? '0.7rem' : '1.2rem'};letter-spacing:${b.label.length > 2 ? '1px' : '0'};border-radius:10px&quot;>${b.label}</span>'`;
            return `<img src="https://www.google.com/s2/favicons?domain=${b.domain}&sz=128" alt="${b.label}" style="width:100%;height:100%;object-fit:contain;padding:4px;border-radius:10px;" onerror="${fallback}">`;
        }
    }
    
    return '<i class="fa-solid fa-car-side"></i>';
}

function renderJobs(jobs) {
    if (jobs.length === 0) {
        elJobsList.innerHTML = `<div class="loading-state"><p>ไม่มีแผนงานสำหรับวันนี้</p></div>`;
        return;
    }

    let html = '';
    
    jobs.forEach(job => {
        let classes = 'job-card';
        if(job.fleet) classes += ' fleet-job';
        if(job.isNew) classes += ' is-new';
        if(job.isUpdated) classes += ' is-updated';

        const actionColor = getActionColor(job.action);
        const catColor = getCategoryColor(job.category);

        html += `
            <div class="${classes}">
                <div class="card-top">
                    <div>
                        <div class="card-time">${job.timeBF || 'No Fixed'}</div>
                        <span class="card-action-badge">
                            <span class="card-action-dot" style="background:${actionColor};box-shadow:0 0 6px ${actionColor}"></span>
                            ${job.action}
                        </span>
                    </div>
                    <div class="card-tags">
                        ${job.category !== 'OTHER' ? `<span class="tag" style="color:${catColor};border-color:${catColor}30;background:${catColor}10">${job.category}</span>` : ''}
                        ${job.fleet 
                            ? `<span class="tag" style="color:#d97706;border-color:#fde68a;background:#fffbeb"><i class="fa-solid fa-people-carry-box"></i> ${job.fleet}</span>` 
                            : `<span class="tag"><i class="fa-solid fa-user"></i> ส่วนตัว</span>`}
                    </div>
                </div>

                <div class="card-body">
                    <div class="card-section">
                        <div class="section-icon">
                            ${getBrandLogo(job.model)}
                        </div>
                        <div class="section-info">
                            <span class="info-label">พาหนะ</span>
                            <span class="info-value">${job.model || 'ไม่ระบุรุ่น'}</span>
                            <span class="plate">${job.plate}</span>
                            <span class="info-sub" style="margin-top:6px"><i class="fa-solid fa-user-tie" style="margin-right:4px"></i>${job.driver} ${job.round ? `(รอบ ${job.round})` : ''}</span>
                            ${job.parking ? `<span class="info-sub" style="color:var(--emerald-600)"><i class="fa-solid fa-square-parking" style="margin-right:4px"></i>จอดที่: ${job.parking}</span>` : ''}
                        </div>
                    </div>

                    <div class="card-section">
                        <div class="section-icon customer">
                            <i class="fa-regular fa-address-book"></i>
                        </div>
                        <div class="section-info">
                            <span class="info-label">ลูกค้า / สถานที่</span>
                            <span class="info-value">${job.customer || '-'}</span>
                            ${job.phone !== '-' ? `<a href="tel:${job.phone.replace(/-/g,'')}" class="btn-call"><i class="fa-solid fa-phone"></i> ${job.phone}</a>` : ''}
                            <div class="address-line"><i class="fa-solid fa-location-dot"></i>${job.displayAddress}</div>
                            ${job.detail ? `<div class="info-sub detail-box" style="margin-top:10px; background: rgba(59,130,246,0.08); padding: 8px 10px; border-radius: 8px; border: 1px solid rgba(59,130,246,0.15); color: var(--slate-700); line-height: 1.4;"><i class="fa-solid fa-circle-info" style="color:var(--blue-500); margin-right:6px"></i>${job.detail}</div>` : ''}
                        </div>
                    </div>
                </div>

                ${job.mapLink ? `
                <div class="card-footer">
                    <a href="${job.mapLink}" target="_blank" class="btn-navigate">
                        <i class="fa-solid fa-diamond-turn-right"></i>
                        <span>นำทาง Google Maps</span>
                    </a>
                </div>
                ` : ''}
            </div>
        `;
    });

    elJobsList.innerHTML = html;
}

function updateKPIs(jobs) {
    kpiTotal.textContent = jobs.length;
    kpiPersonal.textContent = jobs.filter(j => j.isPersonal).length;
    kpiFleet.textContent = jobs.filter(j => !j.isPersonal).length;
}

// --- Profile Setup Logic ---
function initProfileUI() {
    if (userProfile && userProfile.realName && userProfile.nickname) {
        document.getElementById('settings-modal').classList.remove('active');
        document.getElementById('btn-close-modal').style.display = 'flex';
        document.getElementById('user-profile-display').style.display = 'inline-flex';
        document.getElementById('display-name').textContent = userProfile.nickname || userProfile.realName;
        
        document.getElementById('input-realname').value = userProfile.realName;
        document.getElementById('input-nickname').value = userProfile.nickname;
        fetchJobs();
    } else {
        document.getElementById('settings-modal').classList.add('active');
        document.getElementById('btn-close-modal').style.display = 'none';
        document.getElementById('user-profile-display').style.display = 'none';
    }
}

document.getElementById('btn-save-profile').addEventListener('click', () => {
    const realName = document.getElementById('input-realname').value.trim();
    const nickname = document.getElementById('input-nickname').value.trim();
    
    if (!realName || !nickname) {
        alert('กรุณากรอกทั้งชื่อจริงและชื่อเล่น');
        return;
    }
    
    userProfile = { realName, nickname };
    localStorage.setItem('sa_user_profile', JSON.stringify(userProfile));
    
    // Clear old job state to prevent phantom notifications from old driver profile
    jobState = {};
    localStorage.setItem('sa_job_state', JSON.stringify(jobState));
    
    initProfileUI();
});

// --- Modal & Drawer Logic ---
document.getElementById('btn-settings').addEventListener('click', () => {
    document.getElementById('settings-modal').classList.add('active');
});
document.querySelectorAll('.close-modal').forEach(btn => {
    btn.addEventListener('click', (e) => {
        if (!userProfile) return; // Prevent closing if no profile
        const target = e.currentTarget.getAttribute('data-target');
        document.getElementById(target).classList.remove('active');
    });
});
document.getElementById('btn-show-notifications').addEventListener('click', () => {
    document.getElementById('notification-sidebar').classList.add('open');
    document.getElementById('drawer-overlay').classList.add('active');
    badgeNotif.style.display = 'none';
    notificationsCount = 0;
});
document.getElementById('btn-close-sidebar').addEventListener('click', () => {
    document.getElementById('notification-sidebar').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('active');
});
document.getElementById('drawer-overlay').addEventListener('click', () => {
    document.getElementById('notification-sidebar').classList.remove('open');
    document.getElementById('drawer-overlay').classList.remove('active');
});



document.getElementById('btn-sync').addEventListener('click', () => {
    refreshCountdown = REFRESH_INTERVAL;
    fetchJobs();
});

// Morning Summary
document.getElementById('btn-morning-summary').addEventListener('click', showMorningSummary);
function showMorningSummary() {
    const jobs = Object.values(jobState);
    if(jobs.length === 0) {
        alert('ยังไม่มีข้อมูลงานในเช้านี้');
        return;
    }
    let text = `🌅 สรุปแผนงานเช้าวันที่ ${getThaiDateInfo().dayStr}\n\n`;
    jobs.forEach(j => {
        text += `⏰ ${j.timeBF} | 👤 ${j.driver} | 🚗 ${j.plate} | 📍 ${j.action}\n`;
    });
    
    navigator.clipboard.writeText(text).then(() => {
        showToast('คัดลอกสรุปเช้าแล้ว', 'ข้อมูลแผนงานถูกคัดลอกลง Clipboard พร้อมส่งไลน์', 'success');
    }).catch(() => {
        alert('คัดลอกไม่สำเร็จ:\n' + text);
    });
}

// Request Notification Permission
if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    Notification.requestPermission();
}

// Timer Loop
setInterval(() => {
    refreshCountdown--;
    if(refreshCountdown <= 0) {
        refreshCountdown = REFRESH_INTERVAL;
        fetchJobs();
    }
    elCountdown.textContent = `(${refreshCountdown}s)`;
}, 1000);

// Init
initProfileUI();

// --- Scroll-Reveal Animation (IntersectionObserver) ---
const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            revealObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

// Watch for new job cards being added to the DOM
const feedObserver = new MutationObserver(() => {
    const cards = document.querySelectorAll('.job-card:not(.revealed)');
    cards.forEach((card, i) => {
        card.style.setProperty('--i', i);
        revealObserver.observe(card);
    });
});

feedObserver.observe(elJobsList, { childList: true, subtree: true });
