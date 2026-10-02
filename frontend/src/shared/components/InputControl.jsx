import React, { useRef, useState } from 'react';

export default function InputControl({
    clearable = false,
    clearLabel = 'nội dung',
    onClear,
    type = 'text',
    value,
    defaultValue,
    className = '',
    ...inputProps
}) {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const inputRef = useRef(null);
    const isPassword = type === 'password';
    const hasValue = String(value ?? '').length > 0;
    const showClear = clearable && !isPassword && hasValue && typeof onClear === 'function';
    const inputType = isPassword && isPasswordVisible ? 'text' : type;
    const inputValue = value === undefined ? { defaultValue } : { value };

    return (
        <span className={`input-control${isPassword ? ' input-control--password' : ''}${clearable ? ' input-control--clearable' : ''}`}>
            <input
                {...inputProps}
                className={`input-control__input${isPassword || clearable ? ' input-control__input--action' : ''}${className ? ` ${className}` : ''}`}
                ref={inputRef}
                type={inputType}
                {...inputValue}
            />
            {isPassword && (
                <button
                    aria-label={isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-pressed={isPasswordVisible}
                    className="input-control__button input-control__button--password"
                    onMouseDown={event => event.preventDefault()}
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => {
                        setIsPasswordVisible(visible => !visible);
                        inputRef.current?.focus({ preventScroll: true });
                    }}
                    title={isPasswordVisible ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    type="button"
                >
                    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        {isPasswordVisible ? (
                            <><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" /><path d="M9.9 5.2A10.7 10.7 0 0 1 12 5c5.3 0 9 4.7 10 7-.4.9-1.2 2-2.3 3" /><path d="M6.2 6.2C3.9 7.6 2.5 9.7 2 12c1 2.3 4.7 7 10 7 1.1 0 2.1-.2 3-.6" /></>
                        ) : (
                            <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>
                        )}
                    </svg>
                </button>
            )}
            {clearable && !isPassword && (
                <button
                    aria-label={`Xóa ${clearLabel}`}
                    className="input-control__button input-control__button--clear"
                    hidden={!showClear}
                    onMouseDown={event => event.preventDefault()}
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => {
                        onClear();
                        inputRef.current?.focus({ preventScroll: true });
                    }}
                    title={`Xóa ${clearLabel}`}
                    type="button"
                >
                    <svg aria-hidden="true" fill="none" viewBox="0 0 24 24">
                        <path d="m6 6 12 12M18 6 6 18" />
                    </svg>
                </button>
            )}
        </span>
    );
}