package com.demoflowapp.card

object CardViewRegistry {
    private val views = mutableMapOf<String, CardView>()

    fun registerView(sessionId: String, view: CardView) {
        views[sessionId] = view
    }

    fun getView(sessionId: String): CardView? {
        return views[sessionId]
    }

    fun unregisterView(sessionId: String) {
        views.remove(sessionId)
    }
}
