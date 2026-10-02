import React from 'react';
import OrderManagementPage from './OrderManagementPage.jsx';
import AccountManagement from './AccountManagement.jsx';
import AddressManagement from './AddressManagement.jsx';
import FormFieldManagement from './FormFieldManagement.jsx';
import IpManagement from './IpManagement.jsx';
import { useState } from 'react';

export default function AdminDashboard({ onSessionExpired, user }) {
    const [section, setSection] = useState('overview');
    const sections = [
        ['overview', 'Tổng quan'],
        ['accounts', 'Tài khoản'],
        ['addresses', 'Địa chỉ'],
        ['fields', 'Trường nhập'],
        ['ips', 'IP truy cập'],
    ];

    return (
        <div className="admin-dashboard-shell">
            <nav className="admin-management-nav" aria-label="Chức năng quản trị">
                {sections.map(([id, label]) => (
                    <button
                        aria-current={section === id ? 'page' : undefined}
                        className={section === id ? 'is-active' : ''}
                        key={id}
                        onClick={() => setSection(id)}
                        type="button"
                    >{label}</button>
                ))}
            </nav>
            {section === 'overview' && <OrderManagementPage onSessionExpired={onSessionExpired} />}
            {section === 'accounts' && <AccountManagement currentUser={user} onSessionExpired={onSessionExpired} />}
            {section === 'addresses' && <AddressManagement onSessionExpired={onSessionExpired} />}
            {section === 'fields' && <FormFieldManagement onSessionExpired={onSessionExpired} />}
            {section === 'ips' && <IpManagement onSessionExpired={onSessionExpired} />}
        </div>
    );
}