import React from 'react';
import AddressSelector from './AddressSelector.jsx';
import InputControl from '../../shared/components/InputControl.jsx';

export default function OrderForm({
    geography,
    formFields,
    fieldValues,
    districtName,
    communeName,
    villageName,
    barcode,
    onDistrictChange,
    onCommuneChange,
    onVillageChange,
    onBarcodeChange,
    onFieldChange,
    onSubmit,
    error,
    isSubmitting,
}) {
    return (
        <form className="order-form" onSubmit={onSubmit} aria-busy={isSubmitting}>
            <AddressSelector
                geography={geography}
                districtName={districtName}
                communeName={communeName}
                villageName={villageName}
                onDistrictChange={onDistrictChange}
                onCommuneChange={onCommuneChange}
                onVillageChange={onVillageChange}
            />

            <div className="order-field">
                <label className="order-label" htmlFor="barcodeInput">Số mã vận đơn</label>
                <InputControl
                    className="order-control"
                    clearLabel="mã vận đơn"
                    clearable
                    id="barcodeInput"
                    name="barcode"
                    maxLength={512}
                    onClear={() => onBarcodeChange('')}
                    type="text"
                    value={barcode}
                    onChange={event => onBarcodeChange(event.target.value)}
                    placeholder="Nhập mã vận đơn"
                    autoComplete="off"
                    required
                />
            </div>

            {formFields.length > 0 && (
                <fieldset className="order-fieldset order-dynamic-fields">
                    <legend className="order-section-title">Thông tin đơn hàng</legend>
                    <div className="order-dynamic-fields__grid">
                        {formFields.map(field => (
                            field.visible ? (
                                <div className="order-field" key={field.key}>
                                    <label className="order-label" htmlFor={field.key}>
                                        {field.label}:
                                    </label>
                                    <InputControl
                                        className="order-control"
                                        clearLabel={field.label}
                                        clearable
                                        id={field.key}
                                        name={field.key}
                                        onChange={event => onFieldChange(field.key, event.target.value)}
                                        onClear={() => onFieldChange(field.key, '')}
                                        type={field.inputType}
                                        value={fieldValues[field.key] ?? field.defaultValue ?? ''}
                                    />
                                </div>
                            ) : (
                                <input
                                    key={field.key}
                                    id={field.key}
                                    name={field.key}
                                    type="hidden"
                                    value={fieldValues[field.key] ?? field.defaultValue ?? ''}
                                    onChange={event => onFieldChange(field.key, event.target.value)}
                                />
                            )
                        ))}
                    </div>
                </fieldset>
            )}

            {error && <p className="order-error" role="alert">{error}</p>}

            <button
                className="order-submit"
                type="submit"
                disabled={isSubmitting || geography.length === 0}
            >
                {isSubmitting ? 'Đang lưu...' : 'Gửi'}
            </button>
        </form>
    );
}