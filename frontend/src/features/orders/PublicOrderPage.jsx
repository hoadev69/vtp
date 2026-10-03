import React from 'react';
import { useEffect, useRef, useState } from 'react';
import { apiRequest } from '../../shared/api/client.js';
import { useAppNavigation } from '../../shared/NavigationContext.jsx';
import OrderForm from './OrderForm.jsx';

let orderConfigurationRequest;

function loadOrderConfiguration() {
    if (!orderConfigurationRequest) {
        orderConfigurationRequest = Promise.all([
            apiRequest('/api/geography'),
            apiRequest('/api/form-fields'),
        ]).then(([geography, formFields]) => ({ geography, formFields }))
            .catch(error => {
                orderConfigurationRequest = undefined;
                throw error;
            });
    }
    return orderConfigurationRequest;
}

export default function PublicOrderPage() {
    const navigate = useAppNavigation();
    const [geography, setGeography] = useState([]);
    const [formFields, setFormFields] = useState([]);
    const [fieldValues, setFieldValues] = useState({});
    const [districtName, setDistrictName] = useState('');
    const [communeName, setCommuneName] = useState('');
    const [villageName, setVillageName] = useState('');
    const [barcode, setBarcode] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [configurationError, setConfigurationError] = useState('');
    const [configurationAttempt, setConfigurationAttempt] = useState(0);
    const [submitError, setSubmitError] = useState('');
    const submitLock = useRef(false);

    useEffect(() => {
        let isCurrent = true;
        loadOrderConfiguration()
            .then(({ geography: locations, formFields: fields }) => {
                if (!isCurrent) return;
                const defaultDistrict = locations.find(item => item.kind === 'city') || locations[0];
                const defaultCommune = defaultDistrict?.communes?.[0];
                const defaultVillage = defaultCommune?.villages?.[0];
                setGeography(locations);
                setFormFields(fields);
                setFieldValues(Object.fromEntries(fields.map(field => [field.key, field.defaultValue ?? ''])));
                setDistrictName(defaultDistrict?.name || '');
                setCommuneName(defaultCommune?.name || '');
                setVillageName(defaultVillage?.name || '');
            })
            .catch(() => {
                if (isCurrent) setConfigurationError('Không thể tải cấu hình biểu mẫu. Kiểm tra kết nối rồi thử lại.');
            })
            .finally(() => {
                if (isCurrent) setIsLoading(false);
            });

        return () => { isCurrent = false; };
    }, [configurationAttempt]);

    function retryConfiguration() {
        setConfigurationError('');
        setIsLoading(true);
        setConfigurationAttempt(value => value + 1);
    }

    function handleDistrictChange(nextDistrictName) {
        const nextDistrict = geography.find(item => item.name === nextDistrictName);
        const nextCommune = nextDistrict?.communes?.[0];
        setDistrictName(nextDistrictName);
        setCommuneName(nextCommune?.name || '');
        setVillageName(nextCommune?.villages?.[0]?.name || '');
    }

    function handleCommuneChange(nextCommuneName) {
        const selectedDistrict = geography.find(item => item.name === districtName);
        const nextCommune = selectedDistrict?.communes?.find(item => item.name === nextCommuneName);
        setCommuneName(nextCommuneName);
        setVillageName(nextCommune?.villages?.[0]?.name || '');
    }

    async function handleSubmit(event) {
        event.preventDefault();
        if (submitLock.current) return;
        const normalizedBarcode = barcode.trim();
        if (!normalizedBarcode) {
            setSubmitError('Vui lòng nhập mã vận đơn hợp lệ.');
            return;
        }
        submitLock.current = true;
        setSubmitError('');
        setIsSubmitting(true);

        const selectedDistrict = geography.find(item => item.name === districtName);
        const selectedCommune = selectedDistrict?.communes?.find(item => item.name === communeName);
        const hasVillage = (selectedCommune?.villages?.length || 0) > 0;
        const payload = {
            barcode: normalizedBarcode,
            chonHuyen: districtName,
            chonXa: communeName,
            chonThon: hasVillage ? villageName : '',
            fields: Object.fromEntries(formFields.map(field => [field.key, fieldValues[field.key] || ''])),
        };

        try {
            const result = await apiRequest('/api/history', { method: 'POST', body: payload });
            const query = new URLSearchParams();
            query.set('chonHuyen', payload.chonHuyen);
            query.set('chonXa', payload.chonXa);
            query.set('chonThon', payload.chonThon);
            query.set('barcode', payload.barcode);
            Object.entries(result?.fields || {}).forEach(([key, value]) => query.set(key, value));
            navigate(`/ketqua.html?${query}`);
        } catch (error) {
            setSubmitError(error.message || 'Không thể lưu lịch sử tạo mã.');
        } finally {
            submitLock.current = false;
            setIsSubmitting(false);
        }
    }

    return (
        <section className="order-page" aria-labelledby="order-page-title">
            <header className="order-page__heading">
                <p className="order-page__eyebrow">VTP · TẠO ĐƠN</p>
                <h1 id="order-page-title">Nhập dữ liệu</h1>
            </header>

            <div className="order-surface">
                {isLoading ? (
                    <div className="order-loading" aria-busy="true" role="status">
                        <span className="order-loading__message">Đang tải cấu hình biểu mẫu...</span>
                        <div className="order-loading__grid" aria-hidden="true">
                            <span className="order-skeleton" />
                            <span className="order-skeleton" />
                            <span className="order-skeleton order-skeleton--wide" />
                            <span className="order-skeleton" />
                            <span className="order-skeleton" />
                        </div>
                    </div>
                ) : configurationError ? (
                    <div className="order-loading-error">
                        <p className="order-error" role="alert">{configurationError}</p>
                        <button className="order-retry" onClick={retryConfiguration} type="button">Thử lại</button>
                    </div>
                ) : (
                    <OrderForm
                        geography={geography}
                        formFields={formFields}
                        fieldValues={fieldValues}
                        districtName={districtName}
                        communeName={communeName}
                        villageName={villageName}
                        barcode={barcode}
                        onDistrictChange={handleDistrictChange}
                        onCommuneChange={handleCommuneChange}
                        onVillageChange={setVillageName}
                        onBarcodeChange={setBarcode}
                        onFieldChange={(key, value) => setFieldValues(current => ({ ...current, [key]: value }))}
                        onSubmit={handleSubmit}
                        error={submitError}
                        isSubmitting={isSubmitting}
                    />
                )}
            </div>
        </section>
    );
}