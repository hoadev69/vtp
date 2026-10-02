import React from 'react';

function formatDistrict(district) {
    const prefix = district.kind === 'city' ? 'TP.' : 'H.';
    return `${prefix} ${district.name.replace(/^(TP\.|H\.)\s*/, '')}`;
}

export default function AddressSelector({
    geography,
    districtName,
    communeName,
    villageName,
    onDistrictChange,
    onCommuneChange,
    onVillageChange,
}) {
    const selectedDistrict = geography.find(district => district.name === districtName);
    const communes = selectedDistrict?.communes || [];
    const selectedCommune = communes.find(commune => commune.name === communeName);
    const villages = selectedCommune?.villages || [];

    return (
        <fieldset className="order-fieldset order-address">
            <legend className="order-section-title">Địa chỉ nhận hàng</legend>
            <div className="order-address__grid">
                <div className="order-field">
                    <label className="order-label" htmlFor="huyen0">Thành phố/Huyện</label>
                    <select
                        className="order-control"
                        id="huyen0"
                        name="chonHuyen"
                        value={districtName}
                        onChange={event => onDistrictChange(event.target.value)}
                        required
                    >
                        {geography.map(district => (
                            <option key={district.id ?? district.name} value={district.name}>
                                {formatDistrict(district)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="order-field">
                    <label className="order-label" htmlFor="xa0">Xã</label>
                    <select
                        className="order-control"
                        id="xa0"
                        name="chonXa"
                        value={communeName}
                        onChange={event => onCommuneChange(event.target.value)}
                        required
                    >
                        {communes.map(commune => (
                            <option key={commune.id ?? commune.name} value={commune.name}>
                                {commune.name}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="order-field order-field--full">
                    <label className="order-label" htmlFor="thon0">Thôn</label>
                    <select
                        className="order-control"
                        id="thon0"
                        name="chonThon"
                        value={villageName}
                        onChange={event => onVillageChange(event.target.value)}
                    >
                        {villages.map(village => (
                            <option key={village.id ?? village.name} value={village.name}>
                                {village.name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </fieldset>
    );
}