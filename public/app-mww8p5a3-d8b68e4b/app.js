(() => {
  const ROOMS = {
    Standard: { name: 'Standard', price: 2000, maxAdults: 2 },
    Deluxe: { name: 'Deluxe', price: 3500, maxAdults: 3 },
    Suite: { name: 'Suite', price: 6000, maxAdults: 4 },
  };

  const EXTRA_ADULT_RATE = 800;
  const EXTRA_ADULT_ROOMS = new Set(['Deluxe', 'Suite']);
  const LONG_STAY_NIGHTS = 7;
  const LONG_STAY_DISCOUNT_RATE = 0.15;
  const BREAKFAST_RATE = 400;
  const AIRPORT_PICKUP_FEE = 1200;
  const LATE_CHECKOUT_FEE = 700;
  const GST_RATE = 0.12;
  const BOOKINGS_STORAGE_KEY = 'stayease_bookings';

  const BOUNDS = {
    nights: { min: 1, max: 14, fallback: 1 },
    adults: { min: 1, max: 4, fallback: 2 },
    children: { min: 0, max: 3, fallback: 0 },
  };

  let selectedRoomKey = 'Standard';

  const roomCards = Array.from(document.querySelectorAll('.room-card'));
  const selectedRoomNameEl = document.getElementById('selected-room-name');
  const selectedRoomRateEl = document.getElementById('selected-room-rate');
  const selectedRoomLimitEl = document.getElementById('selected-room-limit');

  const nightsInput = document.getElementById('nights-input');
  const adultsInput = document.getElementById('adults-input');
  const childrenInput = document.getElementById('children-input');
  const adultLimitErrorEl = document.getElementById('adult-limit-error');

  const breakfastCheckbox = document.getElementById('addon-breakfast');
  const airportCheckbox = document.getElementById('addon-airport');
  const lateCheckoutCheckbox = document.getElementById('addon-late-checkout');

  const priceLinesEl = document.getElementById('price-lines');
  const subtotalEl = document.getElementById('summary-subtotal');
  const gstEl = document.getElementById('summary-gst');
  const totalEl = document.getElementById('summary-total');
  const guestForm = document.getElementById('guest-form');
  const guestNameInput = document.getElementById('guest-name');
  const guestEmailInput = document.getElementById('guest-email');
  const guestPhoneInput = document.getElementById('guest-phone');
  const guestNameErrorEl = document.getElementById('guest-name-error');
  const guestEmailErrorEl = document.getElementById('guest-email-error');
  const guestPhoneErrorEl = document.getElementById('guest-phone-error');
  const bookBtn = document.getElementById('book-btn');
  const confirmationEl = document.getElementById('booking-confirmation');
  const confirmationMessageEl = document.getElementById('confirmation-message');
  const confirmationMetaEl = document.getElementById('confirmation-meta');
  const bookingsListEl = document.getElementById('bookings-list');
  const bookingsEmptyEl = document.getElementById('bookings-empty');

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const PHONE_REGEX = /^\d{10}$/;

  const guestFields = [
    {
      key: 'name',
      input: guestNameInput,
      errorEl: guestNameErrorEl,
      touched: false,
      validate(value) {
        const trimmed = value.trim();
        if (!trimmed) return 'Please enter your full name';
        if (trimmed.length < 2) return 'Full name must be at least 2 characters';
        return '';
      },
    },
    {
      key: 'email',
      input: guestEmailInput,
      errorEl: guestEmailErrorEl,
      touched: false,
      validate(value) {
        const trimmed = value.trim();
        if (!trimmed) return 'Please enter your email address';
        if (!EMAIL_REGEX.test(trimmed)) return 'Please enter a valid email address';
        return '';
      },
    },
    {
      key: 'phone',
      input: guestPhoneInput,
      errorEl: guestPhoneErrorEl,
      touched: false,
      validate(value) {
        const trimmed = value.trim();
        if (!trimmed) return 'Please enter your 10-digit phone number';
        if (!PHONE_REGEX.test(trimmed)) return 'Please enter a valid 10-digit phone number';
        return '';
      },
    },
  ];

  function validateGuestField(field, forceShow = false) {
    if (!field.input) return true;
    const errorMessage = field.validate(field.input.value);
    const shouldShow = Boolean(errorMessage) && (forceShow || field.touched || field.input.value.trim() !== '');

    field.input.classList.toggle('is-invalid', shouldShow);
    field.input.setAttribute('aria-invalid', String(shouldShow));

    if (field.errorEl) {
      field.errorEl.hidden = !shouldShow;
      field.errorEl.textContent = shouldShow ? errorMessage : '';
    }

    return errorMessage === '';
  }

  function validateAllGuestFields() {
    let firstInvalidInput = null;
    let allValid = true;

    guestFields.forEach((field) => {
      field.touched = true;
      const isValid = validateGuestField(field, true);
      if (!isValid) {
        allValid = false;
        if (!firstInvalidInput && field.input) {
          firstInvalidInput = field.input;
        }
      }
    });

    return { allValid, firstInvalidInput };
  }

  function hideConfirmation() {
    if (confirmationEl) {
      confirmationEl.hidden = true;
    }
  }

  function generateBookingNumber() {
    const existingNumbers = new Set(bookings.map((booking) => booking.number));
    let candidate = '';
    do {
      const code = Math.floor(1000 + Math.random() * 9000);
      candidate = `SE-${code}`;
    } while (existingNumbers.has(candidate) && existingNumbers.size < 9000);
    return candidate;
  }

  function isValidBookingRecord(item) {
    return (
      Boolean(item) &&
      typeof item === 'object' &&
      typeof item.number === 'string' &&
      item.number.trim() !== '' &&
      typeof item.room === 'string' &&
      item.room.trim() !== '' &&
      Number.isInteger(item.nights) &&
      item.nights >= 1 &&
      typeof item.total === 'number' &&
      Number.isFinite(item.total)
    );
  }

  function loadBookings() {
    try {
      const raw = window.localStorage.getItem(BOOKINGS_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidBookingRecord);
    } catch {
      return [];
    }
  }

  function saveBookings(list) {
    try {
      window.localStorage.setItem(BOOKINGS_STORAGE_KEY, JSON.stringify(list));
    } catch {
      // Ignore storage quota or privacy mode errors so the UI keeps working.
    }
  }

  let bookings = loadBookings();

  function cancelBooking(bookingNumber) {
    bookings = bookings.filter((booking) => booking.number !== bookingNumber);
    saveBookings(bookings);
    renderBookings();
  }

  function renderBookings() {
    if (!bookingsListEl || !bookingsEmptyEl) return;

    const hasBookings = bookings.length > 0;
    bookingsEmptyEl.hidden = hasBookings;
    bookingsListEl.hidden = !hasBookings;
    bookingsListEl.innerHTML = '';

    bookings.forEach((booking) => {
      const item = document.createElement('li');
      item.className = 'booking-item';
      item.dataset.bookingNumber = booking.number;

      const info = document.createElement('div');
      info.className = 'booking-item-info';

      const header = document.createElement('div');
      header.className = 'booking-item-header';

      const numberEl = document.createElement('strong');
      numberEl.className = 'booking-number';
      numberEl.textContent = booking.number;

      const roomEl = document.createElement('span');
      roomEl.className = 'booking-room';
      roomEl.textContent = booking.room;

      header.append(numberEl, roomEl);

      const details = document.createElement('div');
      details.className = 'booking-item-details';

      const nightsEl = document.createElement('span');
      nightsEl.className = 'booking-nights';
      nightsEl.textContent = `${booking.nights} ${booking.nights === 1 ? 'night' : 'nights'}`;

      const separator = document.createElement('span');
      separator.setAttribute('aria-hidden', 'true');
      separator.textContent = '·';

      const totalEl = document.createElement('span');
      totalEl.className = 'booking-total';
      totalEl.textContent = `Total ${formatRupees(booking.total)}`;

      details.append(nightsEl, separator, totalEl);
      info.append(header, details);

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'cancel-booking-btn';
      cancelBtn.dataset.cancelBooking = booking.number;
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => {
        cancelBooking(booking.number);
      });

      item.append(info, cancelBtn);
      bookingsListEl.appendChild(item);
    });
  }

  function formatRupees(amount) {
    return `₹${amount}`;
  }

  function parseBoundedInt(input, { min, max, fallback }) {
    if (!input) return fallback;
    const raw = input.value.trim();
    if (raw === '') return fallback;
    const parsed = Number.parseInt(raw, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  function clampInput(input, bounds) {
    if (!input) return;
    const clamped = parseBoundedInt(input, bounds);
    input.value = String(clamped);
  }

  function getBookingState() {
    const room = ROOMS[selectedRoomKey] || ROOMS.Standard;
    const nights = parseBoundedInt(nightsInput, BOUNDS.nights);
    const adults = parseBoundedInt(adultsInput, BOUNDS.adults);
    const children = parseBoundedInt(childrenInput, BOUNDS.children);

    return {
      room,
      nights,
      adults,
      children,
      breakfast: Boolean(breakfastCheckbox && breakfastCheckbox.checked),
      airportPickup: Boolean(airportCheckbox && airportCheckbox.checked),
      lateCheckout: Boolean(lateCheckoutCheckbox && lateCheckoutCheckbox.checked),
    };
  }

  function calculatePricing(state) {
    const { room, nights, adults, children, breakfast, airportPickup, lateCheckout } = state;
    const roomCharge = room.price * nights;
    const extraAdults = EXTRA_ADULT_ROOMS.has(room.name) && adults > 2 ? adults - 2 : 0;
    const extraAdultCharge = extraAdults * EXTRA_ADULT_RATE * nights;
    const longStayDiscount = nights >= LONG_STAY_NIGHTS
      ? Math.round(roomCharge * LONG_STAY_DISCOUNT_RATE)
      : 0;

    const totalGuests = adults + children;
    const breakfastCharge = breakfast ? BREAKFAST_RATE * totalGuests * nights : 0;
    const airportPickupCharge = airportPickup ? AIRPORT_PICKUP_FEE : 0;
    const lateCheckoutCharge = lateCheckout ? LATE_CHECKOUT_FEE : 0;

    const subtotal =
      roomCharge -
      longStayDiscount +
      extraAdultCharge +
      breakfastCharge +
      airportPickupCharge +
      lateCheckoutCharge;

    const gst = Math.round(subtotal * GST_RATE);
    const total = subtotal + gst;

    const lineItems = [
      {
        label: `Room charge (${nights} ${nights === 1 ? 'night' : 'nights'})`,
        value: formatRupees(roomCharge),
      },
    ];

    if (extraAdultCharge > 0) {
      lineItems.push({
        label: `Extra adult (${extraAdults} × ${nights} ${nights === 1 ? 'night' : 'nights'})`,
        value: formatRupees(extraAdultCharge),
      });
    }

    if (longStayDiscount > 0) {
      lineItems.push({
        label: 'Long stay discount',
        value: `−${formatRupees(longStayDiscount)}`,
        isDiscount: true,
      });
    }

    if (breakfastCharge > 0) {
      lineItems.push({
        label: `Breakfast (${totalGuests} ${totalGuests === 1 ? 'guest' : 'guests'} × ${nights} ${nights === 1 ? 'night' : 'nights'})`,
        value: formatRupees(breakfastCharge),
      });
    }

    if (airportPickupCharge > 0) {
      lineItems.push({
        label: 'Airport pickup',
        value: formatRupees(airportPickupCharge),
      });
    }

    if (lateCheckoutCharge > 0) {
      lineItems.push({
        label: 'Late checkout',
        value: formatRupees(lateCheckoutCharge),
      });
    }

    return {
      lineItems,
      subtotal,
      gst,
      total,
    };
  }

  function renderPriceSummary(pricing) {
    if (priceLinesEl) {
      priceLinesEl.innerHTML = '';
      pricing.lineItems.forEach((item) => {
        const row = document.createElement('div');
        row.className = item.isDiscount ? 'price-row price-row-discount' : 'price-row';

        const dt = document.createElement('dt');
        dt.textContent = item.label;

        const dd = document.createElement('dd');
        dd.textContent = item.value;

        row.append(dt, dd);
        priceLinesEl.appendChild(row);
      });
    }

    if (subtotalEl) subtotalEl.textContent = formatRupees(pricing.subtotal);
    if (gstEl) gstEl.textContent = formatRupees(pricing.gst);
    if (totalEl) totalEl.textContent = formatRupees(pricing.total);
  }

  function renderBooking() {
    const state = getBookingState();
    const { room, adults } = state;

    roomCards.forEach((card) => {
      const isSelected = card.dataset.room === room.name;
      card.classList.toggle('is-selected', isSelected);

      const button = card.querySelector('.select-room-btn');
      if (button) {
        button.setAttribute('aria-pressed', String(isSelected));
      }
    });

    if (selectedRoomNameEl) {
      selectedRoomNameEl.textContent = room.name;
    }
    if (selectedRoomRateEl) {
      selectedRoomRateEl.textContent = `₹${room.price} per night`;
    }
    if (selectedRoomLimitEl) {
      selectedRoomLimitEl.textContent = `Max ${room.maxAdults} adults`;
    }

    const exceedsMaxAdults = adults > room.maxAdults;
    if (adultLimitErrorEl) {
      adultLimitErrorEl.hidden = !exceedsMaxAdults;
      adultLimitErrorEl.textContent = exceedsMaxAdults
        ? `This room allows up to ${room.maxAdults} adults`
        : '';
    }
    if (bookBtn) {
      bookBtn.disabled = exceedsMaxAdults;
    }

    const pricing = calculatePricing(state);
    renderPriceSummary(pricing);
  }

  roomCards.forEach((card) => {
    const button = card.querySelector('.select-room-btn');
    if (!button) return;

    button.addEventListener('click', () => {
      const roomName = button.dataset.selectRoom;
      if (roomName && ROOMS[roomName]) {
        selectedRoomKey = roomName;
        renderBooking();
      }
    });
  });

  [
    [nightsInput, BOUNDS.nights],
    [adultsInput, BOUNDS.adults],
    [childrenInput, BOUNDS.children],
  ].forEach(([input, bounds]) => {
    if (!input) return;
    input.addEventListener('input', renderBooking);
    input.addEventListener('change', () => {
      clampInput(input, bounds);
      renderBooking();
    });
  });

  [breakfastCheckbox, airportCheckbox, lateCheckoutCheckbox].forEach((checkbox) => {
    if (!checkbox) return;
    checkbox.addEventListener('change', renderBooking);
  });

  guestFields.forEach((field) => {
    if (!field.input) return;
    field.input.addEventListener('input', () => {
      if (field.input.value !== '') {
        field.touched = true;
      }
      validateGuestField(field);
    });
    field.input.addEventListener('blur', () => {
      field.touched = true;
      validateGuestField(field, true);
    });
  });

  if (guestForm) {
    guestForm.addEventListener('submit', (event) => {
      event.preventDefault();

      clampInput(nightsInput, BOUNDS.nights);
      clampInput(adultsInput, BOUNDS.adults);
      clampInput(childrenInput, BOUNDS.children);
      renderBooking();

      const state = getBookingState();
      const occupancyValid = state.adults <= state.room.maxAdults;
      const { allValid, firstInvalidInput } = validateAllGuestFields();

      if (!occupancyValid || !allValid) {
        hideConfirmation();
        if (firstInvalidInput) {
          firstInvalidInput.focus();
        }
        return;
      }

      const pricing = calculatePricing(state);
      const bookingNumber = generateBookingNumber();
      const guestName = guestNameInput ? guestNameInput.value.trim() : '';
      const guestEmail = guestEmailInput ? guestEmailInput.value.trim() : '';
      const guestPhone = guestPhoneInput ? guestPhoneInput.value.trim() : '';

      bookings.unshift({
        number: bookingNumber,
        room: state.room.name,
        nights: state.nights,
        total: pricing.total,
        guestName,
        guestEmail,
        guestPhone,
      });
      saveBookings(bookings);
      renderBookings();

      if (confirmationMessageEl) {
        confirmationMessageEl.textContent = `Booking ${bookingNumber} confirmed: ${state.room.name}, ${state.nights} nights, total ₹${pricing.total}`;
      }
      if (confirmationMetaEl) {
        confirmationMetaEl.textContent = `Guest: ${guestName} · ${guestEmail} · ${guestPhone}`;
      }
      if (confirmationEl) {
        confirmationEl.hidden = false;
      }
    });
  }

  renderBooking();
  renderBookings();
})();
