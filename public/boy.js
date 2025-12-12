const socket = io();
const list = document.getElementById('list');
let selectedFilesMap = {};
const currentUser = 'pakapop'; // Used for profile picture logic only

// Load saved name
const savedName = localStorage.getItem('sender_name');
if (savedName) document.getElementById('sender-name').value = savedName;

const now = new Date(); now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
document.getElementById('start').value = now.toISOString().slice(0, 16);

function loadProfile() { fetch('/api/profiles').then(r => r.json()).then(d => { if (d.pakapop) document.getElementById('my-avatar').src = d.pakapop; }); } loadProfile();
function uploadProfile(i) { if (i.files[0]) { const r = new FileReader(); r.onload = e => { document.getElementById('my-avatar').src = e.target.result; socket.emit('update_profile', { username: currentUser, avatar: e.target.result }); Swal.fire({ icon: 'success', title: 'เปลี่ยนรูปโปรไฟล์แล้ว', showConfirmButton: false, timer: 1000 }); }; r.readAsDataURL(i.files[0]); } }
socket.on('profile_updated', d => { if (d.username === currentUser) document.getElementById('my-avatar').src = d.avatar; });

fetch('/api/history').then(r => r.json()).then(d => { list.innerHTML = ''; d.forEach(renderTicket); });

function sendRequest() {
    const place = document.getElementById('place').value;
    const start = document.getElementById('start').value;
    const end = document.getElementById('end').value;
    const budget = document.getElementById('budget').value || 0;
    const reason = document.getElementById('reason').value;
    const senderName = document.getElementById('sender-name').value.trim();

    if (!senderName) return Swal.fire({ icon: 'warning', title: 'กรุณากรอกชื่อด้วยนะ' });
    localStorage.setItem('sender_name', senderName); // Save name

    if (!place || !start || !end) return Swal.fire({ icon: 'warning', title: 'ข้อมูลไม่ครบ' });
    if (start >= end) return Swal.fire({ icon: 'error', title: 'เวลาผิดพลาด', text: 'เวลาถึงบ้านต้องหลังเวลาออกเดินทาง' });

    const s = new Date(start), e = new Date(end), days = Math.floor((e - s) / (86400000)), hrs = Math.floor(((e - s) % 86400000) / 3600000);
    const duration = `${days > 0 ? days + ' วัน ' : ''}${hrs} ชม.`;
    const opts = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

    Swal.fire({ title: 'บอกแม่เลยมั้ย?', showCancelButton: true, confirmButtonText: 'ส่งเลย', confirmButtonColor: '#1e293b', cancelButtonText: 'ยกเลิก' }).then(r => {
        if (r.isConfirmed) {
            socket.emit('request_trip', {
                place,
                start_time: s.toLocaleDateString('th-TH', opts),
                end_time: e.toLocaleDateString('th-TH', opts),
                duration,
                budget,
                reason,
                sender_name: senderName
            });
            document.getElementById('place').value = ''; document.getElementById('reason').value = '';
            Swal.fire({ title: 'ส่งแล้ว!', icon: 'success', showConfirmButton: false, timer: 1500 });
        }
    });
}
socket.on('new_request', d => { renderTicket(d); window.scrollTo(0, 0); });
socket.on('trip_deleted', id => { const t = document.getElementById(`t-${id}`); if (t) { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); } });
socket.on('status_changed', d => {
    const t = document.getElementById(`t-${d.id}`);
    if (t) {
        const b = t.querySelector('.status-badge'); b.className = `status-badge px-3 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${d.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : (d.status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}`;
        b.innerHTML = (d.status === 'approved' ? '<i class="fa-solid fa-circle-check"></i>' : (d.status === 'rejected' ? '<i class="fa-solid fa-circle-xmark"></i>' : '<i class="fa-solid fa-circle-pause"></i>')) + ' ' + d.status;
        if (d.status === 'approved') { t.querySelector('.upload-section').classList.remove('hidden'); const rb = t.querySelector('.rejection-box'); if (rb) rb.remove(); Swal.fire({ icon: 'success', title: 'แม่รับทราบแล้ว!' }); }
        else if (d.status === 'rejected') {
            t.querySelector('.upload-section').classList.add('hidden');
            let rb = t.querySelector('.rejection-box'); if (!rb) { rb = document.createElement('div'); rb.className = 'rejection-box mt-4 bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 text-sm animate-bounce'; t.querySelector('.ticket-content').appendChild(rb); }
            rb.innerHTML = `<i class="fa-solid fa-circle-exclamation mr-2"></i> <strong>แม่บอกว่า:</strong> ${d.rejection_reason || 'ไม่ได้ระบุ'}`;
            Swal.fire({ icon: 'info', title: 'แม่ตอบกลับมาว่า', text: d.rejection_reason });
        }
    }
});
socket.on('proof_updated', d => {
    const g = document.getElementById(`proof-gallery-${d.id}`);
    if (g) { g.innerHTML = d.images.map(s => `<div class="aspect-square rounded-lg overflow-hidden border border-slate-200 cursor-pointer" onclick="Swal.fire({imageUrl:'${s}', showConfirmButton:false, background:'transparent'})"><img src="${s}" class="w-full h-full object-cover"></div>`).join(''); g.classList.remove('hidden'); }
});
function renderTicket(d) {
    let imgs = []; try { imgs = JSON.parse(d.proof_image) || []; if (!Array.isArray(imgs)) imgs = [d.proof_image]; } catch (e) { if (d.proof_image) imgs = [d.proof_image]; }
    const isApp = d.status === 'approved', isRej = d.status === 'rejected', hasImg = imgs.length > 0;
    list.insertAdjacentHTML('afterbegin', `
    <div class="bg-white rounded-[20px] p-5 md:p-6 shadow-sm border border-slate-100 fade-in" id="t-${d.id}" data-place="${d.place}">
        <div class="ticket-content">
            <div class="flex justify-between items-start mb-4">
                <div><h4 class="font-bold text-slate-800 text-lg md:text-xl">${d.place}</h4><div class="text-xs text-slate-500 mt-1"><i class="fa-solid fa-stopwatch text-indigo-400"></i> ${d.duration}</div></div>
                <span class="status-badge px-3 py-1 rounded-full text-[10px] md:text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${isApp ? 'bg-emerald-100 text-emerald-700' : (isRej ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700')}">${isApp ? '<i class="fa-solid fa-circle-check"></i>' : (isRej ? '<i class="fa-solid fa-circle-xmark"></i>' : '<i class="fa-solid fa-circle-pause"></i>')} ${d.status}</span>
            </div>
            <div class="space-y-2 text-sm text-slate-600 mb-4 bg-slate-50 p-3 rounded-xl border border-slate-100">
                <div class="flex items-center gap-2"><i class="fa-regular fa-calendar-days text-slate-400 w-5 text-center"></i> ${d.start_time} - ${d.end_time}</div>
            </div>
            <div class="relative pl-3 border-l-2 border-indigo-200 italic text-slate-600 text-sm mb-4">"${d.reason}"</div>
            ${isRej ? `<div class="rejection-box mt-4 bg-rose-50 border border-rose-200 rounded-xl p-4 text-rose-800 text-sm"><i class="fa-solid fa-circle-exclamation mr-2"></i> <strong>แม่บอกว่า:</strong> ${d.rejection_reason || 'ไม่ได้ระบุ'}</div>` : ''}
            <div class="upload-section mt-5 ${isApp && !hasImg ? '' : 'hidden'}">
                <label class="upload-zone-box block w-full cursor-pointer rounded-xl p-4 text-center transition bg-white">
                    <div class="flex flex-col items-center gap-2"><i class="fa-solid fa-images text-indigo-500 text-xl"></i><span class="text-xs md:text-sm text-slate-600">อัปโหลดรูป (สูงสุด 5 รูป)</span></div>
                    <input type="file" accept="image/*" multiple class="hidden" onchange="handleFileSelect(this, ${d.id})">
                </label>
                <div id="preview-container-${d.id}" class="mt-3 grid grid-cols-3 gap-2 hidden"></div>
                <button id="submit-proof-btn-${d.id}" onclick="submitProof(${d.id})" class="mt-3 w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hidden">ส่งหลักฐาน</button>
            </div>
            <div id="proof-gallery-${d.id}" class="mt-4 grid grid-cols-3 gap-2 ${hasImg ? '' : 'hidden'}">${imgs.map(s => `<div class="aspect-square rounded-lg overflow-hidden border border-slate-200 cursor-pointer" onclick="Swal.fire({imageUrl:'${s}', showConfirmButton:false, background:'transparent'})"><img src="${s}" class="w-full h-full object-cover"></div>`).join('')}</div>
        </div>
    </div>`);
}
function handleFileSelect(input, id) {
    if (!input.files.length) return; selectedFilesMap[id] = []; const p = document.getElementById(`preview-container-${id}`); p.innerHTML = ''; p.classList.remove('hidden');
    Array.from(input.files).slice(0, 5).forEach((f, i, a) => { const r = new FileReader(); r.onload = e => { selectedFilesMap[id].push(e.target.result); p.innerHTML += `<div class="aspect-square rounded-lg overflow-hidden border border-slate-200"><img src="${e.target.result}" class="w-full h-full object-cover"></div>`; if (selectedFilesMap[id].length === a.length) document.getElementById(`submit-proof-btn-${id}`).classList.remove('hidden'); }; r.readAsDataURL(f); });
}
function submitProof(id) { const imgs = selectedFilesMap[id]; if (imgs) { document.getElementById(`submit-proof-btn-${id}`).innerText = '...'; socket.emit('send_proof', { id, images: imgs }); setTimeout(() => { document.getElementById(`preview-container-${id}`).classList.add('hidden'); document.querySelector(`#t-${id} .upload-zone-box`).parentElement.classList.add('hidden'); }, 500); } }
