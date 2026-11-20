import { t as tUi, tr as labelUi, useI18n } from '../../../../shared/i18n/useI18n.js'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { usePms } from '../../data/usePms'
import {
  bookingRooms,
  bookingRoomStays,
  today,
  addDays,
  overlaps,
  roomIsBlocked,
} from '../../data/model'
import BookingModal from '../../reservations/components/BookingModal'
import BookingDetailPanel from '../../reservations/components/BookingDetailPanel'
import LegacyOverlay from '../../components/LegacyOverlay'
import RoomLocationFilters from '../components/RoomLocationFilters'
import { groupRoomsByLocation, matchesRoomLocationFilters } from '../roomLocations.js'
import {
  User,
  CalendarDays,
  AlertTriangle,
  DollarSign,
  Sparkles,
  Grid,
  List,
  X,
  Key,
  LogOut,
  Brush,
  ArrowUpRight,
  BedDouble,
  Search,
} from 'lucide-react'
import './RoomDiagram.css'

// Rooms a booking occupies on `day`. With roomStays, a room vacated earlier
// during a move is not current; outside the stay dates (overdue departure or
// later arrival) the nearest stay segment is used.
function bookingRoomsOn(booking, day) {
  if (!booking.roomStays?.length) return bookingRooms(booking)
  const stays = bookingRoomStays(booking)
  let current = stays.filter((stay) => stay.start <= day && stay.end > day)
  if (!current.length) {
    const ended = stays.every((stay) => stay.end <= day)
    const edge = ended
      ? stays.reduce((last, stay) => (stay.end > last ? stay.end : last), '')
      : stays
          .filter((stay) => stay.start > day)
          .reduce((first, stay) => (!first || stay.start < first ? stay.start : first), '')
    current = stays.filter((stay) => (ended ? stay.end === edge : stay.start === edge))
  }
  return current.map((stay) => String(stay.room))
}
const isUnassigned = (booking) => !bookingRooms(booking).length && !booking.roomStays?.length
const searchText = (value) => String(value ?? '').toLowerCase()
const bookingPhones = (booking) =>
  [booking?.phone, ...(booking?.guests || []).map((guest) => guest?.phone)]
    .filter(Boolean)
    .map(String)
function matchesSearch(query, { room, booking }) {
  const text = searchText(query).trim()
  if (!text) return true
  const digits = text.replace(/\D/g, '')
  const phones = bookingPhones(booking)
  return (
    [room, booking?.guest, booking?.id, ...phones].some(
      (value) => value != null && searchText(value).includes(text),
    ) ||
    (digits.length >= 3 &&
      digits.length === text.replace(/[\s.()+-]/g, '').length &&
      phones.some((phone) => phone.replace(/\D/g, '').includes(digits)))
  )
}

export default function RoomDiagram() {
  useI18n()
  const {
    rooms,
    bookings,
    available,
    cleanRoom,
    dirtyRoom,
    changeStatus,
    roomTypes,
    settings,
    roomBlocks,
    setCondition,
    allowAction,
    runAction,
    access,
    housekeepingTasks,
  } = usePms()
  const [selectedRoomNumber, setSelectedRoomNumber] = useState(null)
  const [bookingId, setBookingId] = useState(null)
  const [bookingTab, setBookingTab] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createInitialRooms, setCreateInitialRooms] = useState([])
  const [createInitialCheckIn, setCreateInitialCheckIn] = useState(null)
  const [createInitialCheckOut, setCreateInitialCheckOut] = useState(null)
  const [createIntent, setCreateIntent] = useState('reservation')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [areaFilter, setAreaFilter] = useState('')
  const [floorFilter, setFloorFilter] = useState('')
  const [listView, setListView] = useState(false)
  const [statusFilter, setStatusFilter] = useState('')
  const setSelectedRoom = (room) => {
    setSelectedRoomNumber(room?.number || null)
    setError('')
  }
  const day = today(settings.timezone)
  const roomCards = rooms
    .filter((r) => r.active !== false)
    .map((r) => {
      const inRoom = (b) => bookingRoomsOn(b, day).includes(String(r.id))
      const b =
        bookings.find((b) => inRoom(b) && b.status === 'IN_HOUSE') ||
        bookings.find((b) => inRoom(b) && overlaps(b, day, addDays(day, 1)))
      const blocked = roomIsBlocked(r, roomBlocks, day, addDays(day, 1))
      return {
        blocked,
        condition: r.condition,
        number: r.id,
        typeId: r.typeId,
        area: r.area,
        floor: r.floor,
        name: tUi('rooms.roomName', { room: r.id }),
        state: b ? 'occupied' : 'empty',
        status: b?.status === 'CONFIRMED' ? 'confirmed' : 'in-house',
        guest: b?.guest,
        id: b?.id,
        booking: b || null,
        checkIn: b?.checkIn,
        checkOut: b?.checkOut,
        dirty: r.condition === 'dirty' || r.condition === 'inspection',
        paid: b && Number(b.balance) === 0,
        type: roomTypes.find((t) => t.id === r.typeId)?.name,
      }
    })
  const selectedRoom = roomCards.find((r) => r.number === selectedRoomNumber)
  async function checkout() {
    if (!allowAction('reservations.write', 'RESERVATION_VIEW')) return
    try {
      await changeStatus(
        selectedRoom.id,
        'CHECKED_OUT',
        bookings.find((row) => row.id === selectedRoom.id)?.version,
      )
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }
  const openCreate = (rooms = [], checkIn = null, checkOut = null, intent = 'reservation') => {
    if (allowAction('reservations.write', 'RESERVATION_CREATE')) {
      // Store room + dates BEFORE nulling selectedRoom
      setCreateInitialRooms(rooms)
      setCreateInitialCheckIn(checkIn)
      setCreateInitialCheckOut(checkOut)
      setCreateIntent(intent === 'walk-in' ? 'walk-in' : 'reservation')
      setCreateOpen(true)
      setSelectedRoom(null)
    }
  }
  const stats = [
    {
      label: 'Nhận phòng hôm nay',
      count: bookings
        .filter((b) => b.status === 'CONFIRMED' && b.checkIn === today(settings.timezone))
        .reduce((sum, b) => sum + bookingRooms(b).length, 0),
      kind: 'confirmed',
    },
    {
      label: 'Trả phòng hôm nay',
      count: bookings
        .filter((b) => b.status === 'IN_HOUSE' && b.checkOut === today(settings.timezone))
        .reduce((sum, b) => sum + bookingRooms(b).length, 0),
      kind: 'checkout',
    },
    {
      label: 'Phòng đang có khách',
      count: bookings
        .filter((b) => b.status === 'IN_HOUSE')
        .reduce((sum, b) => sum + bookingRooms(b).length, 0),
      kind: 'occupied',
    },
    {
      label: 'Sẵn sàng bán',
      count: available().filter((r) => r.condition === 'clean').length,
      kind: 'available',
    },
    {
      label: 'Phòng cần dọn',
      count: rooms.filter((r) => r.active !== false && r.condition === 'dirty').length,
      kind: 'dirty',
    },
  ]
  const legend = [
    { key: '', label: 'Tất cả', matches: () => true },
    {
      key: 'empty',
      label: 'Phòng trống',
      matches: (room) => room.state === 'empty' && !room.blocked,
    },
    {
      key: 'confirmed',
      label: 'Đã xác nhận',
      matches: (room) => room.state === 'occupied' && room.status === 'confirmed',
    },
    {
      key: 'occupied',
      label: 'Đang có khách',
      matches: (room) => room.state === 'occupied' && room.status !== 'confirmed',
    },
    { key: 'dirty', label: 'Cần dọn / kiểm tra', matches: (room) => room.dirty },
    { key: 'blocked', label: 'Khóa / bảo trì', matches: (room) => room.blocked },
  ]
  const selectedLegend = legend.find((item) => item.key === statusFilter)
  const unassigned = bookings.filter(
    (b) => isUnassigned(b) && ['CONFIRMED', 'IN_HOUSE'].includes(b.status),
  )
  // Unassigned bookings have no room, location or type; they only survive the
  // all/confirmed/occupied status views and the text search.
  const unassignedStatus = {
    '': () => true,
    confirmed: (b) => b.status === 'CONFIRMED',
    occupied: (b) => b.status === 'IN_HOUSE',
  }[statusFilter]
  const visibleUnassigned =
    !areaFilter && !floorFilter && !typeFilter && unassignedStatus
      ? unassigned.filter((b) => unassignedStatus(b) && matchesSearch(search, { booking: b }))
      : []
  const filteredRooms = roomCards.filter(
    (room) =>
      matchesRoomLocationFilters(room, { area: areaFilter, floor: floorFilter }) &&
      (!typeFilter || room.typeId === typeFilter) &&
      selectedLegend.matches(room) &&
      matchesSearch(search, { room: room.number, booking: room.booking }),
  )
  const locationGroups = groupRoomsByLocation(filteredRooms)
  const filtersActive = Boolean(
    search.trim() || typeFilter || areaFilter || floorFilter || statusFilter,
  )
  const clearFilters = () => {
    setSearch('')
    setTypeFilter('')
    setAreaFilter('')
    setFloorFilter('')
    setStatusFilter('')
  }
  const locationGroupName = (group) =>
    `${group.area ?? tUi('rooms.unassignedArea')} · ${group.floor === null ? tUi('rooms.unassignedFloor') : tUi('rooms.floorName', { floor: group.floor })}`
  const roomLabel = (room) =>
    room.blocked
      ? 'Khóa / bảo trì'
      : room.state === 'empty'
        ? 'Phòng trống'
        : room.status === 'confirmed'
          ? 'Đã xác nhận'
          : 'Đang có khách'
  const roomKind = (room) =>
    room.blocked
      ? 'blocked'
      : room.state === 'empty'
        ? room.dirty
          ? 'dirty'
          : 'empty'
        : room.status === 'confirmed'
          ? 'confirmed'
          : 'occupied'
  const openTaskItem = selectedRoom
    ? housekeepingTasks.find(
        (task) =>
          task.room === selectedRoom.number && !['completed', 'cancelled'].includes(task.status),
      )
    : null
  const hasOpenTask = Boolean(openTaskItem)
  const hkTaskUrl = openTaskItem
    ? `/id/housekeeping/plan?task=${encodeURIComponent(openTaskItem.id)}&date=${encodeURIComponent(openTaskItem.date)}&room=${encodeURIComponent(selectedRoom.number)}`
    : `/id/housekeeping/plan?date=${encodeURIComponent(today(settings.timezone))}&room=${encodeURIComponent(selectedRoom?.number ?? '')}`

  return (
    <div className="loha-rooms">
      <header className="loha-rooms-heading">
        <div>
          <span className="loha-rooms-eyebrow">{tUi('rooms.statusKicker')}</span>
          <h1>{tUi('nav.roomDiagram')}</h1>
          <p>Toàn cảnh phòng và lượt lưu trú trong ngày · {today(settings.timezone)}</p>
        </div>
      </header>
      <div className="loha-rooms-stats" aria-label={tUi('rooms.statsLabel')}>
        {stats.map((stat) => (
          <div key={stat.kind} className={'loha-rooms-stat stat-' + stat.kind}>
            <span>{labelUi(stat.label)}</span>
            <strong>
              {stat.count}
              <span>{tUi('common.roomsLower')}</span>
            </strong>
          </div>
        ))}
      </div>
      <section className="loha-rooms-panel" aria-label={tUi('rooms.byArea')}>
        <div className="loha-rooms-toolbar">
          <div>
            <h2>{tUi('rooms.list')}</h2>
            <p>{tUi('rooms.selectHint')}</p>
          </div>
          <div className="loha-rooms-filters">
            <span className="loha-rooms-search">
              <Search size={15} aria-hidden="true" />
              <label className="loha-rooms-visually-hidden" htmlFor="diagram-search">
                Tìm phòng, khách, mã đặt phòng hoặc SĐT
              </label>
              <input
                id="diagram-search"
                type="search"
                autoComplete="off"
                maxLength={80}
                placeholder="Phòng, khách, mã, SĐT"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </span>
            <label className="loha-rooms-visually-hidden" htmlFor="diagram-type">
              {tUi('common.roomType')}
            </label>
            <select
              id="diagram-type"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">{tUi('common.allRoomTypes')}</option>
              {roomTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <RoomLocationFilters
              rooms={roomCards}
              area={areaFilter}
              floor={floorFilter}
              onAreaChange={setAreaFilter}
              onFloorChange={setFloorFilter}
              idPrefix="diagram"
            />
            <div className="loha-rooms-view" role="group" aria-label={tUi('rooms.view')}>
              <button
                type="button"
                aria-label={tUi('rooms.grid')}
                aria-pressed={!listView}
                onClick={() => setListView(false)}
              >
                <Grid size={16} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label={tUi('rooms.listView')}
                aria-pressed={listView}
                onClick={() => setListView(true)}
              >
                <List size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
        <div className="loha-rooms-legend" aria-label={tUi('rooms.filter')}>
          {legend.map((item) => (
            <button
              key={item.key}
              type="button"
              aria-pressed={statusFilter === item.key}
              className={'legend-' + (item.key || 'all')}
              onClick={() => setStatusFilter(item.key)}
            >
              <span className="loha-rooms-dot" aria-hidden="true" />
              {labelUi(item.label)}
              <strong>{roomCards.filter(item.matches).length}</strong>
            </button>
          ))}
        </div>
        <div className="loha-rooms-results" aria-live="polite">
          <span className="loha-rooms-result-count">
            {filtersActive
              ? `Hiển thị ${filteredRooms.length}/${roomCards.length} phòng`
              : `${roomCards.length} phòng`}
            {visibleUnassigned.length
              ? ` · ${visibleUnassigned.length} đặt phòng chưa xếp phòng`
              : ''}
          </span>
          {filtersActive && (
            <button type="button" className="loha-rooms-clear" onClick={clearFilters}>
              <X size={14} aria-hidden="true" />
              Xóa bộ lọc
            </button>
          )}
        </div>
        <div className="loha-rooms-body">
          {!!visibleUnassigned.length && (
            <section className="loha-rooms-unassigned">
              <div className="loha-rooms-floor-heading">
                <h3>{tUi('rooms.unassigned')}</h3>
                <span>
                  {visibleUnassigned.length} {labelUi('đặt phòng')}
                </span>
              </div>
              <div className={'loha-rooms-grid' + (listView ? ' is-list' : '')}>
                {visibleUnassigned.map((booking) => (
                  <button
                    type="button"
                    key={booking.id}
                    className={
                      'loha-room-card room-' +
                      (booking.status === 'CONFIRMED' ? 'confirmed' : 'occupied')
                    }
                    title={
                      booking.status === 'CONFIRMED' ? tUi('rooms.confirmed') : tUi('hk.occupied')
                    }
                    aria-label={`${tUi('rooms.unassigned')}, ${booking.guest || ''}, #${booking.id}, ${booking.checkIn} → ${booking.checkOut}`}
                    data-booking-id={booking.id}
                    onClick={() => {
                      setBookingId(booking.id)
                      setBookingTab(null)
                    }}
                  >
                    <span className="loha-room-card-top">
                      <strong>{tUi('rooms.unassigned')}</strong>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </span>
                    <span className="loha-room-card-body">
                      <strong className="loha-room-guest">
                        <User size={14} aria-hidden="true" />
                        {booking.guest}
                      </strong>
                      <span className="loha-room-ref" data-i18n-ignore>
                        #{booking.id}
                      </span>
                      <span className="loha-room-stay">
                        {booking.checkIn} → {booking.checkOut}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
          {locationGroups.map((group) => (
            <section className="loha-rooms-floor" key={group.key}>
              <div className="loha-rooms-floor-heading">
                <h3 data-i18n-ignore>{locationGroupName(group)}</h3>
                <span>
                  {group.rooms.length} {tUi('common.roomsLower')}
                </span>
              </div>
              <div className={'loha-rooms-grid' + (listView ? ' is-list' : '')}>
                {group.rooms.map((room) => (
                  <button
                    type="button"
                    key={room.number}
                    className={'loha-room-card room-' + roomKind(room)}
                    onClick={() => setSelectedRoom(room)}
                    title={labelUi(roomLabel(room))}
                    aria-label={`${room.name}, ${labelUi(roomLabel(room))}${room.dirty ? ', cần dọn hoặc kiểm tra' : ''}`}
                  >
                    <span className="loha-room-card-top">
                      <span className="loha-room-card-title">
                        <strong>{room.name}</strong>
                        <span className="loha-room-type">{room.type || tUi('rooms.noType')}</span>
                      </span>
                      <span className="loha-room-card-icons">
                        {room.dirty && (
                          <AlertTriangle
                            className="loha-room-cleaning-icon"
                            size={15}
                            aria-label={
                              room.condition === 'inspection'
                                ? tUi('hk.inspecting')
                                : tUi('hk.dirtyRoom')
                            }
                          />
                        )}
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </span>
                    </span>
                    <span className="loha-room-card-body">
                      {room.state === 'empty' ? (
                        <span className="loha-room-empty">
                          <BedDouble size={22} aria-hidden="true" />
                          <span>{labelUi(roomLabel(room))}</span>
                          {room.dirty && (
                            <small>
                              {room.condition === 'inspection'
                                ? tUi('hk.inspecting')
                                : tUi('rooms.needsCleaningShort')}
                            </small>
                          )}
                        </span>
                      ) : (
                        <>
                          <strong className="loha-room-guest">
                            <User size={14} aria-hidden="true" />
                            {room.guest}
                          </strong>
                          <span className="loha-room-stay">
                            {room.checkIn} → {room.checkOut}
                          </span>
                        </>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            </section>
          ))}
          {!locationGroups.length && !(filtersActive && visibleUnassigned.length) && (
            <div className="loha-rooms-empty" role="status">
              <BedDouble size={32} aria-hidden="true" />
              <strong>{roomCards.length ? tUi('rooms.noMatch') : tUi('rooms.none')}</strong>
              <span>{roomCards.length ? tUi('rooms.filterHint') : tUi('rooms.emptyHint')}</span>
              {roomCards.length > 0 && filtersActive && (
                <button type="button" className="loha-rooms-clear" onClick={clearFilters}>
                  Xem tất cả phòng
                </button>
              )}
            </div>
          )}
        </div>
      </section>
      {selectedRoom && (
        <LegacyOverlay
          title={selectedRoom.name}
          onClose={() => setSelectedRoom(null)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(18,43,68,.4)',
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 12,
          }}
        >
          <div className="loha-room-dialog">
            <header className="loha-room-dialog-heading">
              <div>
                <h2>{selectedRoom.name}</h2>
                <span className={'loha-room-status room-' + roomKind(selectedRoom)}>
                  {labelUi(roomLabel(selectedRoom))}
                </span>
                {selectedRoom.dirty && (
                  <span className="loha-room-dirty">
                    {selectedRoom.condition === 'inspection'
                      ? tUi('hk.inspecting')
                      : tUi('rooms.cleanShort')}
                  </span>
                )}
              </div>
              <button
                type="button"
                aria-label={tUi('common.close')}
                className="loha-room-close"
                onClick={() => setSelectedRoom(null)}
              >
                <X size={18} />
              </button>
            </header>
            <div className="loha-room-dialog-info">
              {selectedRoom.state === 'occupied' ? (
                <>
                  <div>
                    <span>{tUi('hk.stayover')}</span>
                    <strong>{selectedRoom.guest}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.bookingCode')}</span>
                    <strong>{selectedRoom.id}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.stayDates')}</span>
                    <strong>
                      {selectedRoom.checkIn} → {selectedRoom.checkOut}
                    </strong>
                  </div>
                  <div>
                    <span>{tUi('common.roomType')}</span>
                    <strong>{selectedRoom.type}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.payment')}</span>
                    <strong>
                      {selectedRoom.paid ? tUi('rooms.paidFull') : tUi('rooms.notPaidFull')}
                    </strong>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <span>{tUi('common.roomType')}</span>
                    <strong>{selectedRoom.type}</strong>
                  </div>
                  <div>
                    <span>{tUi('rooms.cleaning')}</span>
                    <strong>
                      {selectedRoom.condition === 'inspection'
                        ? tUi('hk.inspecting')
                        : selectedRoom.condition === 'maintenance'
                          ? tUi('hk.maintenanceAction')
                          : selectedRoom.dirty
                            ? tUi('rooms.needsCleaningShort')
                            : tUi('rooms.cleaned')}
                    </strong>
                  </div>
                </>
              )}
            </div>
            {error && (
              <p role="alert" className="loha-room-error">
                {error}
              </p>
            )}
            <div className="loha-room-dialog-actions">
              {access('housekeeping.manage').allowed &&
                !hasOpenTask &&
                selectedRoom.condition !== 'inspection' && (
                  <button
                    type="button"
                    onClick={() =>
                      runAction('housekeeping.write', '', () =>
                        setCondition(
                          selectedRoom.number,
                          selectedRoom.condition === 'maintenance' ? 'dirty' : 'maintenance',
                        ),
                      )
                    }
                  >
                    {selectedRoom.condition === 'maintenance'
                      ? tUi('rooms.endMaintenance')
                      : tUi('rooms.markMaintenance')}
                  </button>
                )}
              <button
                type="button"
                className="loha-rooms-primary"
                onClick={() => {
                  if (selectedRoom.id) {
                    setBookingId(selectedRoom.id)
                    setBookingTab('details')
                    setSelectedRoom(null)
                  } else openCreate([String(selectedRoom.number)])
                }}
              >
                <Grid size={17} aria-hidden="true" />
                {selectedRoom.state === 'empty' ? labelUi('Đặt phòng này') : tUi('rooms.details')}
              </button>
              <div className="loha-room-action-grid">
                {selectedRoom.state === 'empty' ? (
                  <>
                    <button
                      type="button"
                      className="loha-room-walk-in"
                      disabled={selectedRoom.blocked}
                      title={
                        selectedRoom.blocked
                          ? tUi('rooms.lockedHint')
                          : 'Khách vãng lai: tạo đặt phòng, sau đó nhận phòng riêng'
                      }
                      onClick={() =>
                        openCreate([String(selectedRoom.number)], null, null, 'walk-in')
                      }
                    >
                      <Key size={16} aria-hidden="true" />
                      {tUi('rooms.checkIn')}
                    </button>
                    <button type="button" onClick={() => openCreate([String(selectedRoom.number)])}>
                      <CalendarDays size={16} aria-hidden="true" />
                      {tUi('rooms.hold')}
                    </button>
                    {selectedRoom.condition === 'inspection' ||
                    !access('housekeeping.manage').allowed ||
                    hasOpenTask ? (
                      <Link className="loha-room-action-wide" to={hkTaskUrl}>
                        {tUi('rooms.housekeepingTask')}
                      </Link>
                    ) : selectedRoom.dirty ? (
                      <button
                        type="button"
                        className="loha-room-action-wide"
                        onClick={() =>
                          runAction('housekeeping.write', 'HOUSEKEEPING', () =>
                            cleanRoom(selectedRoom.number),
                          )
                        }
                      >
                        <Sparkles size={16} aria-hidden="true" />
                        {tUi('rooms.markClean')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="loha-room-action-wide"
                        onClick={() =>
                          runAction('housekeeping.write', 'HOUSEKEEPING', () =>
                            dirtyRoom(selectedRoom.number),
                          )
                        }
                      >
                        <Brush size={16} aria-hidden="true" />
                        {tUi('rooms.markDirty')}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setBookingId(selectedRoom.id)
                        setBookingTab('details')
                        setSelectedRoom(null)
                      }}
                    >
                      <User size={16} aria-hidden="true" />
                      {tUi('rooms.editBooking')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setBookingId(selectedRoom.id)
                        setBookingTab('services')
                        setSelectedRoom(null)
                      }}
                    >
                      <DollarSign size={16} aria-hidden="true" />
                      {tUi('rooms.services')}
                    </button>
                    <button
                      type="button"
                      className="loha-room-action-wide"
                      disabled={selectedRoom.status !== 'confirmed' && !selectedRoom.paid}
                      title={!selectedRoom.paid ? tUi('rooms.checkoutHint') : ''}
                      onClick={() => {
                        if (selectedRoom.status === 'confirmed') {
                          setBookingId(selectedRoom.id)
                          setBookingTab('details')
                          setSelectedRoom(null)
                        } else checkout()
                      }}
                    >
                      <LogOut size={16} aria-hidden="true" />
                      {selectedRoom.status === 'confirmed'
                        ? tUi('rooms.checkIn')
                        : tUi('rooms.checkOut')}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        </LegacyOverlay>
      )}
      {bookingId && (
        <BookingDetailPanel
          key={bookingId + '|' + (bookingTab || '')}
          bookingId={bookingId}
          initialTab={bookingTab || undefined}
          onClose={() => {
            setBookingId(null)
            setBookingTab(null)
          }}
        />
      )}
      {createOpen && (
        <BookingModal
          initialRooms={createInitialRooms}
          initialCheckIn={createInitialCheckIn || undefined}
          initialCheckOut={createInitialCheckOut || undefined}
          intent={createIntent}
          onClose={() => setCreateOpen(false)}
          onCreated={(created, tab) => {
            setBookingId(created.id)
            setBookingTab(tab)
            setCreateOpen(false)
          }}
        />
      )}
    </div>
  )
}
