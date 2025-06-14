class DotBoxApp {
    constructor() {
        this.token = localStorage.getItem('token') || '';
        this.services = [];
        this.currentService = null; // For release upload
        this._logsWS = null;
        this._statusWS = null;
        this.init();
    }

    async init() {
        this.cacheDom();
        this.bindEvents();
        this.setStatus('Ansluter...');
        await this.checkAuth();
        this.setupSocket();
        await this.loadServices();
    }

    cacheDom() {
        this.serviceList = document.getElementById('serviceList');
        this.addServiceBtn = document.getElementById('addServiceBtn');
        this.serviceModal = document.getElementById('serviceModal');
        this.serviceForm = document.getElementById('serviceForm');
        this.serviceNameInput = document.getElementById('serviceName');
        this.envList = document.getElementById('envList');
        this.addEnvBtn = document.getElementById('addEnvBtn');
        this.cancelServiceBtn = document.getElementById('cancelServiceBtn');
        this.serviceError = document.getElementById('serviceError');
        this.releaseModal = document.getElementById('releaseModal');
        this.releaseForm = document.getElementById('releaseForm');
        this.releaseFile = document.getElementById('releaseFile');
        this.cancelReleaseBtn = document.getElementById('cancelReleaseBtn');
        this.releaseError = document.getElementById('releaseError');
        this.connectionStatus = document.getElementById('connectionStatus');
        this.editEnvModal = document.getElementById('editEnvModal');
        this.editEnvForm = document.getElementById('editEnvForm');
        this.editEnvList = document.getElementById('editEnvList');
        this.addEditEnvBtn = document.getElementById('addEditEnvBtn');
        this.cancelEditEnvBtn = document.getElementById('cancelEditEnvBtn');
        this.editEnvError = document.getElementById('editEnvError');
        this.logsModal = document.getElementById('logsModal');
        this.logsArea = document.getElementById('logsArea');
        this.logsServiceName = document.getElementById('logsServiceName');
        this.logsError = document.getElementById('logsError');
        this.closeLogsBtn = document.getElementById('closeLogsBtn');
        this.clearLogsBtn = document.getElementById('clearLogsBtn');
    }

    bindEvents() {
        this.addServiceBtn.onclick = () => this.openServiceModal();
        this.cancelServiceBtn.onclick = () => this.closeServiceModal();
        this.addEnvBtn.onclick = () => this.addEnvRow();
        this.serviceForm.onsubmit = (e) => this.handleCreateService(e);
        this.cancelReleaseBtn.onclick = () => this.closeReleaseModal();
        this.releaseForm.onsubmit = (e) => this.handleUploadRelease(e);
        this.addEditEnvBtn.onclick = () => this.addEditEnvRow();
        this.cancelEditEnvBtn.onclick = () => this.closeEditEnvModal();
        this.editEnvForm.onsubmit = (e) => this.handleEditEnv(e);
        this.closeLogsBtn.onclick = () => this.closeLogsModal();
        this.clearLogsBtn.onclick = () => this.clearLogs();
    }

    setStatus(text, ok = true) {
        this.connectionStatus.textContent = text;
        this.connectionStatus.style.color = ok ? '#a6e3a1' : '#f38ba8';
    }

    async checkAuth() {
        if (!this.token) {
            await this.promptAuth();
        }
    }

    async promptAuth() {
        let pw;
        do {
            pw = prompt('Admin-lösenord krävs:');
            if (!pw) continue;
            try {
                const res = await fetch('/api/auth/token', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: pw })
                });
                if (res.ok) {
                    const data = await res.json();
                    this.token = data.token;
                    localStorage.setItem('token', this.token);
                    break;
                } else {
                    alert('Fel lösenord. Försök igen.');
                }
            } catch {
                alert('Kunde inte ansluta till servern.');
            }
        } while (!this.token);
    }

    async api(url, opts = {}) {
        opts.headers = opts.headers || {};
        opts.headers['Authorization'] = 'Bearer ' + this.token;
        if (opts.json) {
            opts.headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(opts.json);
            delete opts.json;
        }
        const res = await fetch(url, opts);
        if (res.status === 401) {
            localStorage.removeItem('token');
            this.token = '';
            await this.promptAuth();
            return this.api(url, opts);
        }
        return res;
    }

    async loadServices() {
        try {
            const res = await this.api('/api/services');
            if (!res.ok) throw new Error('Kunde inte hämta tjänster');
            this.services = await res.json();
            this.renderServices();
            this.setStatus('Ansluten', true);
        } catch (e) {
            this.setStatus('Kunde inte ansluta', false);
            this.serviceList.innerHTML = `<div class="error">${e.message}</div>`;
        }
    }

    renderServices() {
        this.serviceList.innerHTML = '';
        if (!this.services.length) {
            this.serviceList.innerHTML = '<div>Inga tjänster skapade ännu.</div>';
            return;
        }
        for (const svc of this.services) {
            const card = document.createElement('div');
            card.className = 'service-card';
            const active = svc.activeRelease || {};
            card.innerHTML = `
                <div class="service-header">
                    <div><b>${svc.name}</b></div>
                    <button class="btn" data-upload="${svc.name}">Ladda upp release</button>
                </div>
                <div class="env-list">
                    <b>ENV:</b>
                    ${Object.keys(svc.env).length ? '' : '<span>Inga ENV-variabler</span>'}
                    ${Object.entries(svc.env).map(([k,v]) => `<div class="env-item"><span>${k}</span>=<span>${v}</span></div>`).join('')}
                    <button class="btn btn-secondary" data-edit-env="${svc.name}">Redigera ENV</button>
                </div>
                <div class="release-meta">
                    <b>Aktiv release:</b><br>
                    ${active.metadata && active.metadata.name ? `<span><b>${active.metadata.name}</b> v${active.metadata.version || ''}</span><br>` : ''}
                    ${active.metadata && active.metadata.description ? `<span>${active.metadata.description}</span><br>` : ''}
                    <span>Status: <b>${svc.status === 'running' ? 'Kör' : 'Stoppad'}</b></span>
                </div>
                <div class="service-actions">
                    <button class="btn btn-secondary" data-start="${svc.name}">Starta</button>
                    <button class="btn btn-secondary" data-stop="${svc.name}">Stoppa</button>
                    <button class="btn btn-secondary" data-restart="${svc.name}">Starta om</button>
                    <button class="btn btn-secondary" data-logs="${svc.name}">Visa loggar</button>
                </div>
                <div class="release-list" id="releases-${svc.name}"></div>
                <div class="error" id="error-${svc.name}"></div>
            `;
            this.serviceList.appendChild(card);
            card.querySelector('[data-upload]').onclick = () => this.openReleaseModal(svc.name);
            card.querySelector('[data-start]').onclick = () => this.handleServiceAction(svc.name, 'start');
            card.querySelector('[data-stop]').onclick = () => this.handleServiceAction(svc.name, 'stop');
            card.querySelector('[data-restart]').onclick = () => this.handleServiceAction(svc.name, 'restart');
            card.querySelector('[data-edit-env]').onclick = () => this.openEditEnvModal(svc.name);
            card.querySelector('[data-logs]').onclick = () => this.openLogsModal(svc.name);
            this.loadReleases(svc.name);
        }
    }

    async loadReleases(serviceName) {
        const el = document.getElementById('releases-' + serviceName);
        if (!el) return;
        el.innerHTML = 'Laddar releases...';
        try {
            const res = await this.api(`/api/services/${serviceName}/releases`);
            if (!res.ok) throw new Error('Kunde inte hämta releases');
            const releases = await res.json();
            const svc = this.services.find(s => s.name === serviceName);
            if (!releases.length) {
                el.innerHTML = '<div>Inga releases uppladdade.</div>';
                return;
            }
            el.innerHTML = releases.map(r => `
                <div class="release-item">
                    <span>${r.createdAt.split('T')[0]} ${svc.activeReleaseId === r.id ? '<span class="active-release">(aktiv)</span>' : ''}</span>
                    <span>
                        <button class="btn btn-secondary" data-activate="${r.id}" ${svc.activeReleaseId === r.id ? 'disabled' : ''}>Aktivera</button>
                        <button class="btn btn-danger" data-delete="${r.id}">Ta bort</button>
                    </span>
                </div>
            `).join('');
            for (const r of releases) {
                const btn = el.querySelector(`[data-activate="${r.id}"]`);
                if (btn) btn.onclick = () => this.activateRelease(serviceName, r.id);
                const delBtn = el.querySelector(`[data-delete="${r.id}"]`);
                if (delBtn) delBtn.onclick = () => this.deleteRelease(serviceName, r.id);
            }
        } catch (e) {
            el.innerHTML = `<div class="error">${e.message}</div>`;
        }
    }

    async activateRelease(serviceName, releaseId) {
        try {
            const res = await this.api(`/api/services/${serviceName}/releases/${releaseId}/activate`, { method: 'POST' });
            if (!res.ok) throw new Error('Kunde inte aktivera release');
            await this.loadServices();
        } catch (e) {
            alert(e.message);
        }
    }

    async deleteRelease(serviceName, releaseId) {
        if (!confirm('Ta bort denna release?')) return;
        try {
            const res = await this.api(`/api/services/${serviceName}/releases/${releaseId}`, { method: 'DELETE' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                alert(data.message || 'Kunde inte ta bort release');
                return;
            }
            await this.loadReleases(serviceName);
            await this.loadServices();
        } catch (e) {
            alert(e.message);
        }
    }

    openServiceModal() {
        this.serviceModal.classList.add('show');
        this.serviceForm.reset();
        this.envList.innerHTML = '';
        this.addEnvRow();
        this.serviceError.textContent = '';
    }

    closeServiceModal() {
        this.serviceModal.classList.remove('show');
    }

    addEnvRow(key = '', value = '') {
        const row = document.createElement('div');
        row.className = 'env-row';
        row.innerHTML = `
            <input type="text" placeholder="KEY" value="${key}">
            <input type="text" placeholder="VALUE" value="${value}">
            <button type="button" class="btn btn-danger">&times;</button>
        `;
        row.querySelector('.btn-danger').onclick = () => row.remove();
        this.envList.appendChild(row);
    }

    getEnvFromForm() {
        const env = {};
        for (const row of this.envList.querySelectorAll('.env-row')) {
            const [k, v] = row.querySelectorAll('input');
            if (k.value) env[k.value] = v.value;
        }
        return env;
    }

    async handleCreateService(e) {
        e.preventDefault();
        const name = this.serviceNameInput.value.trim();
        if (!name) {
            this.serviceError.textContent = 'Namn krävs';
            return;
        }
        const env = this.getEnvFromForm();
        try {
            const res = await this.api('/api/services', {
                method: 'POST',
                json: { name, env }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                this.serviceError.textContent = data.message || 'Fel vid skapande av tjänst';
                return;
            }
            this.closeServiceModal();
            await this.loadServices();
            this.openReleaseModal(name);
        } catch (e) {
            this.serviceError.textContent = e.message;
        }
    }

    openReleaseModal(serviceName) {
        this.currentService = serviceName;
        this.releaseModal.classList.add('show');
        this.releaseForm.reset();
        this.releaseError.textContent = '';
    }

    closeReleaseModal() {
        this.releaseModal.classList.remove('show');
        this.currentService = null;
    }

    async handleUploadRelease(e) {
        e.preventDefault();
        if (!this.currentService) return;
        const file = this.releaseFile.files[0];
        if (!file) {
            this.releaseError.textContent = 'Välj en .tgz-fil att ladda upp';
            return;
        }
        const formData = new FormData();
        formData.append('package', file);
        try {
            const res = await fetch(`/api/services/${this.currentService}/releases`, {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + this.token },
                body: formData
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                this.releaseError.textContent = data.message || 'Fel vid uppladdning';
                return;
            }
            this.closeReleaseModal();
            await this.loadServices();
        } catch (e) {
            this.releaseError.textContent = e.message;
        }
    }

    async handleServiceAction(serviceName, action) {
        const errorEl = document.getElementById('error-' + serviceName);
        errorEl.textContent = '';
        try {
            const res = await this.api(`/api/services/${serviceName}/${action}`, { method: 'POST' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                errorEl.textContent = data.message || `Fel vid ${action}`;
                return;
            }
            await this.loadServices();
        } catch (e) {
            errorEl.textContent = e.message;
        }
    }

    setupSocket() {
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        this._statusWS = new WebSocket(`${proto}://${location.host}/ws/status`);
        
        this._statusWS.onopen = () => {
            // Auth: send token as protocol
            this._statusWS.send(JSON.stringify({ token: this.token }));
        };

        this._statusWS.onmessage = (e) => {
            const update = JSON.parse(e.data);
            switch (update.type) {
                case 'initial':
                    this.services = update.data.services;
                    this.renderServices();
                    break;
                case 'status':
                    this.updateServiceStatus(update.service, update.data);
                    break;
                case 'env':
                    this.updateServiceEnv(update.service, update.data);
                    break;
                case 'release':
                    this.updateServiceRelease(update.service, update.data);
                    break;
            }
        };

        this._statusWS.onerror = (e) => {
            console.error('WebSocket error:', e);
            this.setStatus('WebSocket-fel: ' + (e.message || ''));
        };

        this._statusWS.onclose = () => {
            console.log('WebSocket closed, reconnecting...');
            setTimeout(() => this.setupSocket(), 1000);
        };
    }

    updateServiceStatus(serviceName, data) {
        const service = this.services.find(s => s.name === serviceName);
        if (service) {
            service.status = data.status;
            if (data.pm2) {
                service.pm2 = data.pm2;
            }
            this.updateServiceCard(service);
        }
    }

    updateServiceEnv(serviceName, data) {
        const service = this.services.find(s => s.name === serviceName);
        if (service) {
            service.env = data.env;
            this.updateServiceCard(service);
        }
    }

    updateServiceRelease(serviceName, data) {
        const service = this.services.find(s => s.name === serviceName);
        if (service) {
            if (data.release) {
                service.releases.push(data.release);
            }
            if (data.activeReleaseId) {
                service.activeReleaseId = data.activeReleaseId;
            }
            this.updateServiceCard(service);
        }
    }

    updateServiceCard(service) {
        const card = document.querySelector(`[data-service="${service.name}"]`);
        if (card) {
            // Update status
            const statusEl = card.querySelector('.service-status');
            if (statusEl) {
                statusEl.textContent = service.status;
                statusEl.className = `service-status ${service.status}`;
            }

            // Update env
            const envEl = card.querySelector('.service-env');
            if (envEl) {
                envEl.textContent = Object.entries(service.env)
                    .map(([k, v]) => `${k}=${v}`)
                    .join('\n');
            }

            // Update releases
            const releasesEl = card.querySelector('.service-releases');
            if (releasesEl) {
                releasesEl.innerHTML = service.releases
                    .map(r => `
                        <div class="release ${r.id === service.activeReleaseId ? 'active' : ''}">
                            <span class="release-id">${r.id}</span>
                            <span class="release-date">${new Date(r.createdAt).toLocaleString()}</span>
                            ${r.id === service.activeReleaseId ? '<span class="active-badge">Aktiv</span>' : ''}
                        </div>
                    `)
                    .join('');
            }
        }
    }

    openEditEnvModal(serviceName) {
        this.editEnvModal.classList.add('show');
        this.editEnvForm.dataset.service = serviceName;
        this.editEnvList.innerHTML = '';
        this.editEnvError.textContent = '';
        const svc = this.services.find(s => s.name === serviceName);
        if (svc && svc.env) {
            for (const [k, v] of Object.entries(svc.env)) {
                this.addEditEnvRow(k, v);
            }
        }
        if (!this.editEnvList.children.length) this.addEditEnvRow();
    }

    closeEditEnvModal() {
        this.editEnvModal.classList.remove('show');
        this.editEnvForm.dataset.service = '';
    }

    addEditEnvRow(key = '', value = '') {
        const row = document.createElement('div');
        row.className = 'env-row';
        row.innerHTML = `
            <input type="text" placeholder="KEY" value="${key}">
            <input type="text" placeholder="VALUE" value="${value}">
            <button type="button" class="btn btn-danger">&times;</button>
        `;
        row.querySelector('.btn-danger').onclick = () => row.remove();
        this.editEnvList.appendChild(row);
    }

    getEditEnvFromForm() {
        const env = {};
        for (const row of this.editEnvList.querySelectorAll('.env-row')) {
            const [k, v] = row.querySelectorAll('input');
            if (k.value) env[k.value] = v.value;
        }
        return env;
    }

    async handleEditEnv(e) {
        e.preventDefault();
        const service = this.editEnvForm.dataset.service;
        const env = this.getEditEnvFromForm();
        try {
            const res = await this.api(`/api/services/${service}/env`, {
                method: 'PUT',
                json: { env }
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                this.editEnvError.textContent = data.message || 'Fel vid uppdatering av ENV';
                return;
            }
            this.closeEditEnvModal();
            await this.loadServices();
        } catch (e) {
            this.editEnvError.textContent = e.message;
        }
    }

    openLogsModal(serviceName) {
        this.logsModal.classList.add('show');
        this.logsServiceName.textContent = serviceName;
        this.logsArea.textContent = 'Laddar loggar...';
        this.logsError.textContent = '';
        this._logsWS = null;
        this._logsService = serviceName;
        this.fetchLogs(serviceName);
    }

    closeLogsModal() {
        this.logsModal.classList.remove('show');
        this.logsArea.textContent = '';
        this.logsError.textContent = '';
        if (this._logsWS) {
            this._logsWS.close();
            this._logsWS = null;
        }
        this._logsService = null;
    }

    async fetchLogs(serviceName) {
        try {
            const res = await this.api(`/api/services/${serviceName}/logs?tail=1000`);
            if (!res.ok) throw new Error('Kunde inte hämta loggar');
            const data = await res.json();
            this.logsArea.textContent = (data.lines || []).join('\n');
            this.scrollLogsToBottom();
            this.connectLogsWS(serviceName);
        } catch (e) {
            this.logsError.textContent = e.message;
        }
    }

    connectLogsWS(serviceName) {
        if (this._logsWS) this._logsWS.close();
        const proto = location.protocol === 'https:' ? 'wss' : 'ws';
        const ws = new WebSocket(`${proto}://${location.host}/ws/logs/${encodeURIComponent(serviceName)}`);
        ws.onopen = () => {
            // Auth: send token as protocol
            ws.send(JSON.stringify({ token: this.token }));
        };
        ws.onmessage = (e) => {
            this.logsArea.textContent += (this.logsArea.textContent ? '\n' : '') + e.data;
            this.scrollLogsToBottom();
        };
        ws.onerror = (e) => {
            this.logsError.textContent = 'WebSocket-fel: ' + (e.message || '');
        };
        ws.onclose = () => {
            // Optionally reconnect
        };
        this._logsWS = ws;
    }

    scrollLogsToBottom() {
        setTimeout(() => {
            this.logsArea.scrollTop = this.logsArea.scrollHeight;
        }, 50);
    }

    async clearLogs() {
        if (!this._logsService) return;
        this.clearLogsBtn.disabled = true;
        this.logsError.textContent = '';
        try {
            const res = await this.api(`/api/services/${this._logsService}/clear-logs`, { method: 'POST' });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                this.logsError.textContent = data.message || 'Kunde inte rensa loggar';
                return;
            }
            this.logsArea.textContent = '';
        } catch (e) {
            this.logsError.textContent = e.message;
        } finally {
            this.clearLogsBtn.disabled = false;
        }
    }
}

window.app = new DotBoxApp(); 