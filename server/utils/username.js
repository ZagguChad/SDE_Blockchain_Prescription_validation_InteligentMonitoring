const normalizeUsername = (name) => {
    if (!name) return '';
    return name.trim().toLowerCase().replace(/\s+/g, '-');
};

const generatePatientUsername = (name, prescriptionId) => {
    const normalizedName = normalizeUsername(name);
    // Use full prescription ID to ensure uniqueness and match password
    return `${normalizedName}-${prescriptionId}`;
};

module.exports = { normalizeUsername, generatePatientUsername };
