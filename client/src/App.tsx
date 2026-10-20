import { Navigate, Outlet, Route, Routes } from "react-router";
import Layout from "./components/Layout";
import { useAuth } from "./stores/auth";
import { homeFor } from "./lib/routes";
import type { Role } from "./types";
import Login from "./pages/Login";
import Home from "./pages/customer/Home";
import Assessment from "./pages/customer/Assessment";
import Book from "./pages/customer/Book";
import Checkout from "./pages/customer/Checkout";
import Confirmed from "./pages/customer/Confirmed";
import PaymentStatus from "./pages/customer/PaymentStatus";
import Pay from "./pages/Pay";
import Bookings from "./pages/customer/Bookings";
import LiveSession from "./pages/customer/LiveSession";
import History from "./pages/customer/History";
import TrainerToday from "./pages/trainer/Today";
import TrainerSession from "./pages/trainer/Session";
import Availability from "./pages/trainer/Availability";
import AdminBookings from "./pages/admin/Bookings";
import AdminBooking from "./pages/admin/Booking";
import AdminPricing from "./pages/admin/Pricing";

function RequireRole({ role }: { role: Role }) {
    const user = useAuth((s) => s.user);
    if (!user) return <Navigate to="/login" replace />;
    if (user.role !== role) return <Navigate to={homeFor[user.role]} replace />;
    return <Outlet />;
}

export default function App() {
    return (
        <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/pay/:providerOrderId" element={<Pay />} />
            <Route element={<Layout />}>
                <Route element={<RequireRole role="customer" />}>
                    <Route path="/" element={<Home />} />
                    <Route path="/profile" element={<Assessment />} />
                    <Route path="/book" element={<Book />} />
                    <Route path="/checkout" element={<Checkout />} />
                    <Route path="/confirmed/:id" element={<Confirmed />} />
                    <Route path="/bookings" element={<Bookings />} />
                    <Route path="/bookings/:id/status" element={<PaymentStatus />} />
                    <Route path="/session/:id" element={<LiveSession />} />
                    <Route path="/history" element={<History />} />
                </Route>
                <Route element={<RequireRole role="trainer" />}>
                    <Route path="/trainer" element={<TrainerToday />} />
                    <Route path="/trainer/session/:id" element={<TrainerSession />} />
                    <Route path="/trainer/availability" element={<Availability />} />
                </Route>
                <Route element={<RequireRole role="admin" />}>
                    <Route path="/admin" element={<AdminBookings />} />
                    <Route path="/admin/bookings/:id" element={<AdminBooking />} />
                    <Route path="/admin/pricing" element={<AdminPricing />} />
                </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}
